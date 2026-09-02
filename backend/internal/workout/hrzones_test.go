package workout

import (
	"context"
	"testing"
	"time"
)

func TestHRZoneBoundsBpm(t *testing.T) {
	if got := HRZoneBoundsBpm(200, 0, "max"); got != [4]int{120, 140, 160, 180} {
		t.Errorf("max model bounds = %v, want [120 140 160 180]", got)
	}
	// Karvonen measures against the reserve above resting.
	if got := HRZoneBoundsBpm(200, 50, "reserve"); got != [4]int{140, 155, 170, 185} {
		t.Errorf("reserve model bounds = %v, want [140 155 170 185]", got)
	}
	// Reserve falls back to max when there is no usable resting HR.
	if got := HRZoneBoundsBpm(200, 0, "reserve"); got != [4]int{120, 140, 160, 180} {
		t.Errorf("reserve without resting = %v, want the max-model bounds", got)
	}
}

func TestHRZoneCountsBucketsSamples(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	in := Input{
		Name:      "intervals",
		Type:      TypeRun,
		StartTime: time.Date(2026, 9, 1, 7, 0, 0, 0, time.UTC),
		Duration:  600,
		Source:    SourceUpload,
		AvgHR:     150,
		MaxHR:     200,
		HRTimeline: []HRPoint{
			{T: 0, HR: 100}, {T: 1, HR: 110}, // zone 1 (< 120)
			{T: 2, HR: 130}, // zone 2
			{T: 3, HR: 150}, // zone 3
			{T: 4, HR: 170}, // zone 4
			{T: 5, HR: 190}, {T: 6, HR: 200}, // zone 5 (>= 180)
		},
	}
	w, err := svc.Create(ctx, 1, in)
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	counts, err := repo.HRZoneCounts(ctx, 1, HRZoneBoundsBpm(200, 0, "max"))
	if err != nil {
		t.Fatalf("HRZoneCounts: %v", err)
	}
	if got, want := counts[w.ID], [5]int{2, 1, 1, 1, 2}; got != want {
		t.Errorf("zone counts = %v, want %v", got, want)
	}
}

// A workout with no heart rate must not appear in the summary at all, rather
// than as a row of zeros that would drag the shares down.
func TestHRZoneCountsSkipsWorkoutsWithoutHR(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	w, err := svc.Create(ctx, 1, Input{
		Name: "manual", Type: TypeRun, Duration: 600, Distance: 5000, Source: SourceManual,
		StartTime: time.Date(2026, 9, 2, 7, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	counts, err := repo.HRZoneCounts(ctx, 1, HRZoneBoundsBpm(200, 0, "max"))
	if err != nil {
		t.Fatalf("HRZoneCounts: %v", err)
	}
	if _, ok := counts[w.ID]; ok {
		t.Errorf("a workout with no heart rate should not be in the summary")
	}
}
