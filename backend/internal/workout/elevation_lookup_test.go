package workout

import (
	"context"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/elevation"
)

// The sampling is where a mistake would be silent: a profile that drops the
// last point loses the final descent, and one that is not evenly spread puts
// the hills at the wrong times.
func TestSampleIndexes(t *testing.T) {
	if got := sampleIndexes(5, 400); len(got) != 5 || got[0] != 0 || got[4] != 4 {
		t.Errorf("a short route should be taken whole, got %v", got)
	}
	// Spread across the last index rather than the count, which is why the
	// middle ones are not round numbers: 0, 999/4, 999/2 and so on.
	got := sampleIndexes(1000, 5)
	want := []int{0, 250, 500, 749, 999}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("sampleIndexes(1000, 5) = %v, want %v", got, want)
		}
	}
	// Always both ends, at every size: the start and the finish are where a
	// profile is read from.
	for _, n := range []int{2, 3, 401, 5000, 99999} {
		s := sampleIndexes(n, 400)
		if s[0] != 0 || s[len(s)-1] != n-1 {
			t.Errorf("sampleIndexes(%d, 400) runs %d..%d, want 0..%d", n, s[0], s[len(s)-1], n-1)
		}
	}
}

func TestElevationLookupBuildsSeriesOnTheWorkoutsClock(t *testing.T) {
	svc := NewService(nil)
	svc.UseElevation(func(_ context.Context, points []elevation.Point) ([]float64, error) {
		out := make([]float64, len(points))
		for i := range out {
			out[i] = float64(i) * 10
		}
		return out, nil
	})
	w := &Workout{Duration: 100, Route: []LatLng{{0, 0}, {0, 1}, {0, 2}, {0, 3}, {0, 4}}}
	if err := svc.lookUpElevation(context.Background(), w); err != nil {
		t.Fatalf("lookUpElevation() error = %v", err)
	}
	if len(w.ElevTimeline) != 5 {
		t.Fatalf("got %d samples for a 5-point route", len(w.ElevTimeline))
	}
	// Evenly spread over the duration, the same way the map's scrubber relates
	// a route index to a moment.
	if w.ElevTimeline[0].T != 0 || w.ElevTimeline[4].T != 100 || w.ElevTimeline[2].T != 50 {
		t.Errorf("series is not on the workout's clock: %v", w.ElevTimeline)
	}
	if !w.ElevationLookup {
		t.Error("a looked-up series is not marked as one, so the chart cannot say so")
	}
}

func TestElevationLookupNeedsARouteAndAProvider(t *testing.T) {
	svc := NewService(nil)
	if err := svc.lookUpElevation(context.Background(), &Workout{Route: []LatLng{{0, 0}, {0, 1}}}); err == nil {
		t.Error("with no provider configured the lookup should be refused, not silently skipped")
	}
	svc.UseElevation(func(context.Context, []elevation.Point) ([]float64, error) { return nil, nil })
	if err := svc.lookUpElevation(context.Background(), &Workout{}); err == nil {
		t.Error("a workout with no route has nothing to look up")
	}
}
