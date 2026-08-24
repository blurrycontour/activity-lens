// Package elevation fills in the altitude a recording did not carry.
//
// A GPS track without an elevation series is common and not a fault: plenty of
// devices record position from satellites and altitude from a barometer they do
// not have, and some exporters drop the series on the way out. The workout then
// has a route on a map and no climb, no descent, and no elevation chart — which
// is the one number a hilly ride is mostly about.
//
// The route itself is enough to answer it. Every point has coordinates, and a
// digital elevation model knows what the ground is doing there. The source is
// Open-Meteo's elevation endpoint, chosen for the same reasons the weather
// package chose Open-Meteo: no key to obtain or store, free for non-commercial
// use, and one more host rather than one more account. Behind it is Copernicus
// GLO-90, a 90-metre grid.
//
// Which is the honest limit of this. Ninety metres is wider than most trails
// and every switchback, so the profile it returns is the shape of the hill and
// not the shape of your ride: a climb comes back smoothed, and a flat lap round
// a park comes back flat rather than gently noisy. It answers "how much
// climbing was in this route" well and "what did my watch see" not at all,
// which is why nothing calls it unless it is asked to.
package elevation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const elevationBase = "https://api.open-meteo.com/v1/elevation"

// batchSize is how many coordinates go in one request, and it is the API's
// limit rather than a choice.
const batchSize = 100

// fetchTimeout bounds one request. Unlike the weather pass this runs inside a
// user's click, so it is shorter: someone watching a spinner would rather be
// told it failed than watch it for a quarter of a minute.
const fetchTimeout = 10 * time.Second

/*
Resolution, and the bounds on it.

The model has one height per 90 metres, so that is the interval worth sampling
at: closer together and neighbouring points come back with the same number,
which is what a stepped, blocky profile is made of; further apart and a hill is
drawn as a straight line between two points partway up it.

So the count follows the distance rather than being a flat number. A flat 400
was both at once — every five metres on a park run, every quarter kilometre on
a long ride, and only right in between. The floor keeps a short walk from being
three points; the ceiling keeps a a hundred-kilometre ride to ten requests.
*/
const (
	metresPerSample = 90
	minPoints       = 60
	maxPoints       = 1000
)

// ErrUnavailable means the lookup could not be done — the service refused, or
// could not be reached. Every failure here is this one: unlike the weather
// pass, nothing retries in the background, so there is no permanent-versus-
// transient decision for a caller to make.
var ErrUnavailable = errors.New("elevation: lookup unavailable")

// Point is a coordinate to look up, in degrees.
type Point struct{ Lat, Lon float64 }

// Fetcher is the seam the API server holds, matching weather.Fetcher so both
// are injected the same way and a nil one means the feature is simply off.
type Fetcher func(ctx context.Context, points []Point) ([]float64, error)

// Client talks to Open-Meteo.
type Client struct {
	// Fields rather than package-level values so a test can point at an
	// httptest server and so the timeout is this package's to set.
	client  *http.Client
	baseURL string
}

// New builds a client against the public endpoint.
func New() *Client {
	return &Client{client: &http.Client{}, baseURL: elevationBase}
}

// MaxPoints is how many coordinates one call may carry.
func MaxPoints() int { return maxPoints }

// SampleCount is how many points to ask for along a route of this length in
// metres — one per cell of the model behind it, within bounds.
func SampleCount(distanceM float64) int {
	n := int(distanceM / metresPerSample)
	return max(minPoints, min(maxPoints, n))
}

type elevationResponse struct {
	Error     bool      `json:"error"`
	Reason    string    `json:"reason"`
	Elevation []float64 `json:"elevation"`
}

// At returns the ground elevation in metres at each point, in the same order.
//
// Batched, and sequentially: the batches are a few, they are for one person who
// pressed a button, and firing them in parallel at a free service to save a
// second is not a trade worth making.
func (c *Client) At(ctx context.Context, points []Point) ([]float64, error) {
	if len(points) == 0 {
		return nil, fmt.Errorf("%w: no points", ErrUnavailable)
	}
	if len(points) > maxPoints {
		return nil, fmt.Errorf("%w: %d points is more than the %d allowed", ErrUnavailable, len(points), maxPoints)
	}
	out := make([]float64, 0, len(points))
	for start := 0; start < len(points); start += batchSize {
		end := min(start+batchSize, len(points))
		batch, err := c.fetch(ctx, points[start:end])
		if err != nil {
			return nil, err
		}
		// A short batch means the answer does not line up with the question,
		// and a route stitched from misaligned answers is worse than none:
		// every number after the gap belongs to somewhere else.
		if len(batch) != end-start {
			return nil, fmt.Errorf("%w: asked for %d points and got %d", ErrUnavailable, end-start, len(batch))
		}
		out = append(out, batch...)
	}
	return out, nil
}

func (c *Client) fetch(ctx context.Context, points []Point) ([]float64, error) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	lats := make([]string, len(points))
	lons := make([]string, len(points))
	for i, p := range points {
		// Six decimals is about a tenth of a metre, which is far finer than the
		// model behind this and keeps the URL from being needlessly long.
		lats[i] = strconv.FormatFloat(p.Lat, 'f', 6, 64)
		lons[i] = strconv.FormatFloat(p.Lon, 'f', 6, 64)
	}
	q := url.Values{}
	q.Set("latitude", strings.Join(lats, ","))
	q.Set("longitude", strings.Join(lons, ","))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"?"+q.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()

	// Bounded, because this is a response from somewhere else: a body that
	// never ends would otherwise be read until the process ran out of memory.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: %s", ErrUnavailable, resp.Status)
	}
	var parsed elevationResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	// Open-Meteo answers a rejected request with 200 and this, so the status
	// code alone is not the test.
	if parsed.Error {
		return nil, fmt.Errorf("%w: %s", ErrUnavailable, parsed.Reason)
	}
	return parsed.Elevation, nil
}
