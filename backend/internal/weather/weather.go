// Package weather looks up the historical conditions a workout happened in.
//
// The source is Open-Meteo, which is the right fit for a self-hosted app: no
// API key to obtain or store, free for non-commercial use, and an archive going
// back to 1940 — so a workout imported from a two-year-old export is an
// ordinary lookup rather than a special case.
//
// Two endpoints, because the archive is not the awkward part. ERA5 reanalysis
// lags roughly five days behind real time, so the *recent* workouts are the
// ones it cannot answer for; the forecast endpoint carries the last 92 days and
// covers them. Both return the same shape, so the only thing that varies is the
// base URL.
//
// What this package will not do is pretend to more precision than it has. ERA5
// is a ~25 km grid: it knows whether the afternoon was hot and humid, and it
// does not know that one valley was in shade.
package weather

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ErrPermanent wraps a failure that will never succeed for this input: a
// rejected request, an out-of-range date, or a window with no usable samples.
//
// The distinction is the whole reason this package returns errors at all rather
// than logging and dropping them the way the notify package does. The caller
// has to choose between "settle this row and never ask again" and "try later",
// and it cannot make that choice from an opaque error.
var ErrPermanent = errors.New("weather: permanent failure")

const (
	archiveBase  = "https://archive-api.open-meteo.com/v1/archive"
	forecastBase = "https://api.open-meteo.com/v1/forecast"

	// fetchTimeout bounds one attempt, mirroring notify's pushTimeout. The
	// background pass is not on anyone's critical path, but an attempt that
	// never returns would stall every later item behind it.
	fetchTimeout = 15 * time.Second

	// archiveCutoff is how old a workout must be before the archive is asked
	// instead of the forecast endpoint.
	//
	// The two windows overlap enormously — the archive is good from about five
	// days back, the forecast to ninety-two — so this number wants to be far
	// from both edges rather than accurate. At thirty days, neither a
	// mis-set device clock, a timezone mistake, nor a backfill that sat in the
	// queue for a week can land a request on the wrong side of a boundary.
	archiveCutoff = 30 * 24 * time.Hour
)

// hourlyFields is what we ask for, and the order is irrelevant — responses are
// keyed by name. Temperature is the correlation variable; apparent temperature
// is the better physiological predictor since it already folds in humidity,
// wind and radiation. The rest cost nothing extra in the same request and are
// what make a reading legible: "28 °C" alone does not explain a bad run.
var hourlyFields = []string{
	"temperature_2m",
	"apparent_temperature",
	"relative_humidity_2m",
	"wind_speed_10m",
	"precipitation",
	"weather_code",
}

// Conditions is the aggregate across every hour a workout touched.
type Conditions struct {
	TempC     float64
	ApparentC float64
	Humidity  float64
	WindKph   float64
	PrecipMm  float64
	Code      int
}

// Fetcher is the seam the rest of the app depends on.
//
// A function type rather than an interface, matching notify.PrefsLoader and
// settings.VAPIDKeys: one method, and the caller should not have to import this
// package's types to substitute it.
type Fetcher func(ctx context.Context, lat, lon float64, start time.Time, dur time.Duration) (Conditions, error)

// Client talks to Open-Meteo.
type Client struct {
	// A field rather than http.DefaultClient so a test can point it at an
	// httptest server, and so the timeout is this package's to set.
	client *http.Client
	// Base URLs are fields for the same reason. Tests replace both.
	archiveURL  string
	forecastURL string
}

// New builds a client against the public endpoints.
func New() *Client {
	return &Client{client: &http.Client{}, archiveURL: archiveBase, forecastURL: forecastBase}
}

// hourlyResponse is the shape both endpoints return.
//
// Every series is []*float64 rather than []float64 because Open-Meteo genuinely
// emits nulls for hours it has no value for. Decoded into float64 those would
// silently become 0 — a plausible temperature, an impossible humidity, and a
// data error nobody would ever notice.
type hourlyResponse struct {
	Error  bool   `json:"error"`
	Reason string `json:"reason"`
	Hourly struct {
		Time        []string   `json:"time"`
		Temperature []*float64 `json:"temperature_2m"`
		Apparent    []*float64 `json:"apparent_temperature"`
		Humidity    []*float64 `json:"relative_humidity_2m"`
		WindSpeed   []*float64 `json:"wind_speed_10m"`
		Precip      []*float64 `json:"precipitation"`
		Code        []*float64 `json:"weather_code"`
	} `json:"hourly"`
}

// At returns the conditions over [start, start+dur) at lat/lon.
func (c *Client) At(ctx context.Context, lat, lon float64, start time.Time, dur time.Duration) (Conditions, error) {
	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	start = start.UTC()
	// A workout with no recorded duration still happened at a moment; treat it
	// as instantaneous rather than as an empty window that matches no hours.
	if dur < 0 {
		dur = 0
	}
	end := start.Add(dur)

	base := c.forecastURL
	if time.Since(start) > archiveCutoff {
		base = c.archiveURL
	}

	q := url.Values{}
	q.Set("latitude", trimFloat(lat))
	q.Set("longitude", trimFloat(lon))
	// Explicit dates rather than past_days, so one URL builder serves both
	// endpoints. A workout that crosses midnight spans two dates, which is why
	// this is a range and not a single day.
	q.Set("start_date", start.Format("2006-01-02"))
	q.Set("end_date", end.Format("2006-01-02"))
	q.Set("hourly", strings.Join(hourlyFields, ","))
	// UTC on both sides. Workout start times are stored UTC and ERA5 is UTC, so
	// asking for anything else would introduce a conversion with nothing to
	// gain from it.
	q.Set("timezone", "UTC")
	q.Set("wind_speed_unit", "kmh")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+q.Encode(), nil)
	if err != nil {
		return Conditions{}, fmt.Errorf("%w: build request: %v", ErrPermanent, err)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		// Transport failures are the retryable kind: no network, DNS, a reset.
		return Conditions{}, fmt.Errorf("weather request: %w", err)
	}
	defer resp.Body.Close()

	// Bounded: a wrong URL that returns a large body should not be read into
	// memory in full. A day of hourly data for six fields is a few KB.
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return Conditions{}, fmt.Errorf("read weather response: %w", err)
	}

	switch {
	case resp.StatusCode == http.StatusTooManyRequests:
		// Retryable, and the one status where backing off is the entire remedy.
		return Conditions{}, fmt.Errorf("weather: rate limited (%d)", resp.StatusCode)
	case resp.StatusCode >= 500:
		return Conditions{}, fmt.Errorf("weather: server error (%d)", resp.StatusCode)
	case resp.StatusCode >= 400:
		// Open-Meteo explains itself in the body, and the reason is genuinely
		// useful ("Parameter 'start_date' is out of allowed range"). Carrying it
		// into the log is the difference between a fixable report and a mystery.
		return Conditions{}, fmt.Errorf("%w: %s", ErrPermanent, describeError(body, resp.StatusCode))
	}

	var parsed hourlyResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return Conditions{}, fmt.Errorf("%w: parse response: %v", ErrPermanent, err)
	}
	// A 200 can still carry an error object.
	if parsed.Error {
		return Conditions{}, fmt.Errorf("%w: %s", ErrPermanent, parsed.Reason)
	}
	return aggregate(parsed, start, end)
}

// describeError pulls Open-Meteo's reason out of an error body, falling back to
// the status when it is not there.
func describeError(body []byte, status int) string {
	var parsed struct {
		Reason string `json:"reason"`
	}
	if err := json.Unmarshal(body, &parsed); err == nil && parsed.Reason != "" {
		return parsed.Reason
	}
	return fmt.Sprintf("rejected with status %d", status)
}

// aggregate reduces the hourly series to one reading over the workout's span.
//
// Means for the scalars, a sum for precipitation — total millimetres is what a
// person can read, where a mean of mm/h is not — and the maximum weather code,
// since WMO codes run roughly by severity and "what was the worst it got" is
// what anyone remembers about a ride.
func aggregate(r hourlyResponse, start, end time.Time) (Conditions, error) {
	var (
		out   Conditions
		n     int
		sumT  float64
		sumA  float64
		sumH  float64
		sumW  float64
		haveT bool
	)
	// An instantaneous workout still needs one hour to land in.
	if !end.After(start) {
		end = start.Add(time.Nanosecond)
	}
	for i, ts := range r.Hourly.Time {
		// Open-Meteo returns naive local time; we asked for UTC.
		hourStart, err := time.Parse("2006-01-02T15:04", ts)
		if err != nil {
			continue
		}
		hourStart = hourStart.UTC()
		// The hour [hourStart, +1h) overlaps the workout.
		if !hourStart.Add(time.Hour).After(start) || !end.After(hourStart) {
			continue
		}
		// Temperature is the reason this record exists; an hour without one
		// contributes nothing rather than contributing a zero.
		t := sampleAt(r.Hourly.Temperature, i)
		if t == nil {
			continue
		}
		n++
		haveT = true
		sumT += *t
		sumA += valueOr(r.Hourly.Apparent, i, *t)
		sumH += valueOr(r.Hourly.Humidity, i, 0)
		sumW += valueOr(r.Hourly.WindSpeed, i, 0)
		out.PrecipMm += valueOr(r.Hourly.Precip, i, 0)
		if code := int(valueOr(r.Hourly.Code, i, 0)); code > out.Code {
			out.Code = code
		}
	}
	if n == 0 || !haveT {
		// A window the archive has no data for. Permanent: asking again
		// tomorrow returns the same nothing, and a row that retries forever is
		// worse than one that admits it has no answer.
		return Conditions{}, fmt.Errorf("%w: no samples cover the workout", ErrPermanent)
	}
	out.TempC = round1(sumT / float64(n))
	out.ApparentC = round1(sumA / float64(n))
	out.Humidity = round1(sumH / float64(n))
	out.WindKph = round1(sumW / float64(n))
	out.PrecipMm = round1(out.PrecipMm)
	return out, nil
}

// valueOr reads one optional sample, substituting def for a null or a short
// series. Only ever used for the fields where a missing value is genuinely
// neutral — no rain, no wind — never for temperature.
func valueOr(series []*float64, i int, def float64) float64 {
	if v := sampleAt(series, i); v != nil {
		return *v
	}
	return def
}

func sampleAt(series []*float64, i int) *float64 {
	if i < 0 || i >= len(series) {
		return nil
	}
	return series[i]
}

func round1(v float64) float64 { return math.Round(v*10) / 10 }

// trimFloat formats a coordinate without scientific notation or trailing zeros.
func trimFloat(v float64) string {
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.5f", v), "0"), ".")
}
