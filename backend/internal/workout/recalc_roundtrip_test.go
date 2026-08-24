package workout

import (
	"context"
	"testing"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/elevation"
)

// What the client is handed back has to be the workout as it now stands.
//
// The page replaces what it is showing with this response rather than
// re-reading the workout, so anything missing here is a chart that does not
// appear until you leave the page and come back.
func TestRecalculateReturnsTheSeriesItJustBuilt(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	svc.UseElevation(func(_ context.Context, points []elevation.Point) ([]float64, error) {
		out := make([]float64, len(points))
		for i := range out {
			out[i] = float64(i)
		}
		return out, nil
	})

	created, err := svc.Create(context.Background(), 1, Input{
		Name:      "Ride with no altitude",
		Type:      TypeRide,
		StartTime: time.Now().Add(-time.Hour),
		Duration:  3600,
		Distance:  20000,
		Route:     []LatLng{{51.0, -0.1}, {51.001, -0.1}, {51.002, -0.1}},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if len(created.ElevTimeline) != 0 {
		t.Fatalf("test workout was supposed to start with no altitude")
	}

	got, err := svc.Recalculate(context.Background(), 1, created.ID,
		RecalcParts{ElevationLookup: true}, CalorieProfile{})
	if err != nil {
		t.Fatalf("Recalculate() error = %v", err)
	}
	if len(got.ElevTimeline) == 0 {
		t.Error("the response carries no elevation series, so the page has nothing to draw")
	}
	if !got.ElevationLookup {
		t.Error("the response does not say the series was looked up, so the chart cannot mark it")
	}

	// And it is on disk, not only in the answer.
	stored, err := repo.Get(context.Background(), 1, created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if len(stored.ElevTimeline) != len(got.ElevTimeline) || !stored.ElevationLookup {
		t.Error("the lookup did not survive being written")
	}
}
