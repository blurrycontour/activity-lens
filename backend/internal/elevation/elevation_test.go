package elevation

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	return &Client{client: srv.Client(), baseURL: srv.URL}
}

// More than one batch is the case worth proving: the API takes a hundred
// coordinates at a time, and a route sampled to four hundred is four requests
// whose answers have to come back in one list, in order.
func TestBatchesAndKeepsOrder(t *testing.T) {
	var batches int
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		batches++
		lats := strings.Split(r.URL.Query().Get("latitude"), ",")
		if len(lats) > batchSize {
			t.Errorf("batch of %d, over the API's limit of %d", len(lats), batchSize)
		}
		out := make([]float64, len(lats))
		for i := range out {
			// Encodes the position within the batch and the batch itself, so a
			// misordered or misaligned stitch is visible in the result.
			out[i] = float64(batches*1000 + i)
		}
		_ = json.NewEncoder(w).Encode(elevationResponse{Elevation: out})
	})

	points := make([]Point, 250)
	got, err := c.At(context.Background(), points)
	if err != nil {
		t.Fatalf("At() error = %v", err)
	}
	if batches != 3 {
		t.Errorf("made %d requests, want 3 for 250 points", batches)
	}
	if len(got) != 250 {
		t.Fatalf("got %d elevations for 250 points", len(got))
	}
	if got[0] != 1000 || got[100] != 2000 || got[200] != 3000 || got[249] != 3049 {
		t.Errorf("batches stitched out of order: %v %v %v %v", got[0], got[100], got[200], got[249])
	}
}

// Open-Meteo answers a rejected request with 200 and an error body, so the
// status code alone is not the test. Read as data this would be an empty
// series, which is a workout with no climb rather than a failure.
func TestErrorBodyIsAFailure(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(elevationResponse{Error: true, Reason: "latitude must be in range"})
	})
	if _, err := c.At(context.Background(), []Point{{Lat: 91}}); err == nil {
		t.Fatal("a 200 carrying an error body was read as a result")
	}
}

// A batch that comes back short would misalign every point after it: the
// answers are matched to the questions by position and nothing else.
func TestShortBatchIsRefused(t *testing.T) {
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(elevationResponse{Elevation: []float64{1, 2}})
	})
	if _, err := c.At(context.Background(), []Point{{}, {}, {}}); err == nil {
		t.Fatal("a short answer was accepted and would have shifted the series")
	}
}

// Resolution follows the route's length, so a short walk and a long ride are
// both sampled at the model's own spacing rather than at the same count.
func TestSampleCountFollowsDistance(t *testing.T) {
	for _, tc := range []struct {
		distanceM float64
		want      int
	}{
		{0, minPoints},      // a workout with no distance still gets a floor
		{1000, minPoints},   // a park run: 11 cells, floored
		{18000, 200},        // an 18 km ride: one point per 90 m
		{45000, 500},        //
		{200000, maxPoints}, // an audax: capped at ten requests
	} {
		if got := SampleCount(tc.distanceM); got != tc.want {
			t.Errorf("SampleCount(%v) = %d, want %d", tc.distanceM, got, tc.want)
		}
	}
}

func TestRefusesMoreThanItCanAsk(t *testing.T) {
	c := New()
	if _, err := c.At(context.Background(), make([]Point, maxPoints+1)); err == nil {
		t.Fatal("no cap on the number of points")
	}
	if _, err := c.At(context.Background(), nil); err == nil {
		t.Fatal("an empty lookup was accepted")
	}
}
