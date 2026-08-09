package workout

import (
	"context"
	"reflect"
	"testing"
)

// samples builds an HR timeline at one-second intervals over the given ranges,
// so a gap between two ranges is a gap in the recording.
func samples(ranges ...[2]int) []HRPoint {
	var out []HRPoint
	for _, r := range ranges {
		for t := r[0]; t < r[1]; t++ {
			out = append(out, HRPoint{T: t, HR: 140})
		}
	}
	return out
}

func TestDetectPauses(t *testing.T) {
	for _, tc := range []struct {
		name string
		w    Workout
		want []Pause
	}{
		{
			name: "an unbroken recording has no pauses",
			w:    Workout{HRTimeline: samples([2]int{0, 600})},
		},
		{
			name: "a stop at a road crossing",
			w:    Workout{HRTimeline: samples([2]int{0, 300}, [2]int{420, 900})},
			want: []Pause{{From: 299, To: 420}},
		},
		{
			name: "two stops",
			w: Workout{HRTimeline: samples(
				[2]int{0, 300}, [2]int{420, 600}, [2]int{700, 1200},
			)},
			want: []Pause{{From: 299, To: 420}, {From: 599, To: 700}},
		},
		{
			// A dropped sample or a moment of lost signal. Nobody describes a
			// workout as having paused for eight seconds.
			name: "a brief hole is not a pause",
			w:    Workout{HRTimeline: samples([2]int{0, 300}, [2]int{308, 900})},
		},
		{
			// Too few points to establish a rhythm: a hand-entered workout, or
			// a file sampled once a minute. Guessing is worse than saying
			// nothing.
			name: "a sparse series says nothing",
			w:    Workout{HRTimeline: []HRPoint{{T: 0}, {T: 600}, {T: 1200}}},
		},
		{
			name: "no series at all says nothing",
			w:    Workout{Duration: 1800},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := DetectPauses(&tc.w)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("DetectPauses = %v, want %v", got, tc.want)
			}
		})
	}
}

// A device recording every five seconds is not pausing every five seconds. The
// absolute floor alone would be fine here, but a device on smart recording can
// leave half a minute of steady road unsampled, and that is not a pause either.
func TestDetectPausesScalesToTheSamplingRate(t *testing.T) {
	var five []HRPoint
	for t := 0; t < 1200; t += 5 {
		five = append(five, HRPoint{T: t, HR: 140})
	}
	// A 35-second hole: over the 20-second floor, under 8 × 5s.
	var withHole []HRPoint
	for _, p := range five {
		if p.T > 600 && p.T < 635 {
			continue
		}
		withHole = append(withHole, p)
	}
	if got := DetectPauses(&Workout{HRTimeline: withHole}); got != nil {
		t.Fatalf("a 35s hole at 5s sampling is not a pause, got %v", got)
	}
	// …but a two-minute one is, at any sampling rate.
	var withPause []HRPoint
	for _, p := range five {
		if p.T > 600 && p.T < 720 {
			continue
		}
		withPause = append(withPause, p)
	}
	if got := DetectPauses(&Workout{HRTimeline: withPause}); len(got) != 1 {
		t.Fatalf("a two-minute hole is a pause, got %v", got)
	}
}

// The pace series is windowed: it only emits a sample once enough time or
// ground has passed, so its holes are a property of how pace is computed. Read
// as pauses, every slow workout would be mostly paused.
func TestDetectPausesIgnoresThePaceSeries(t *testing.T) {
	var pace []PacePoint
	for t := 0; t < 1800; t += 120 {
		pace = append(pace, PacePoint{T: t, Pace: 300})
	}
	if got := DetectPauses(&Workout{PaceTimeline: pace}); got != nil {
		t.Fatalf("pace samples are not recording times, got %v", got)
	}
}

func TestMovingSeconds(t *testing.T) {
	pauses := []Pause{{From: 300, To: 420}, {From: 600, To: 700}}
	if got := MovingSeconds(1800, pauses); got != 1580 {
		t.Fatalf("MovingSeconds = %d, want 1580", got)
	}
	if got := MovingSeconds(1800, nil); got != 1800 {
		t.Fatalf("MovingSeconds with no pauses = %d, want 1800", got)
	}
	// A corrupt series, or timestamps running past the stated duration. A
	// negative moving time would reach pace and speed as a figure nobody could
	// account for.
	if got := MovingSeconds(100, pauses); got != 100 {
		t.Fatalf("MovingSeconds with impossible pauses = %d, want the duration back", got)
	}
}

// The whole point of the feature: the averages are over moving time, so a wait
// at a level crossing does not read as having run slower.
func TestDeriveMetricsExcludesPauses(t *testing.T) {
	w := &Workout{
		Type:       TypeRun,
		Distance:   5000,
		Duration:   1800,
		HRTimeline: samples([2]int{0, 900}, [2]int{1200, 1800}),
	}
	deriveMetrics(w, 0)
	if len(w.Pauses) != 1 {
		t.Fatalf("Pauses = %v, want one", w.Pauses)
	}
	if w.MovingTime != 1800-(1200-899) {
		t.Fatalf("MovingTime = %d, want %d", w.MovingTime, 1800-(1200-899))
	}
	// 1499 s over 5 km, not 1800.
	wantPace := float64(w.MovingTime) / 5
	if w.AvgPace != wantPace {
		t.Fatalf("AvgPace = %v, want %v (elapsed time would give %v)", w.AvgPace, wantPace, 1800.0/5)
	}
}

// The same trap the weather columns have: both scanners take positional
// arguments against one column list, so a drift shifts every field after it and
// the values still look like values.
func TestPausesSurviveBothScanners(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	in := importInput("paused run", "hash-paused")
	in.HRTimeline = samples([2]int{0, 900}, [2]int{1200, 1800})
	wk, _, err := svc.CreateIdempotent(ctx, 1, in)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if len(wk.Pauses) != 1 {
		t.Fatalf("create found %v pauses, want one", wk.Pauses)
	}

	got, err := repo.Get(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !reflect.DeepEqual(got.Pauses, wk.Pauses) {
		t.Errorf("detail pauses = %v, want %v", got.Pauses, wk.Pauses)
	}
	if got.MovingTime != wk.MovingTime {
		t.Errorf("detail moving time = %d, want %d", got.MovingTime, wk.MovingTime)
	}

	// The summary set carries the moving time but not the intervals: the list
	// ranks on the averages, which are already computed from it.
	list, err := repo.ListSummary(ctx, 1)
	if err != nil {
		t.Fatalf("ListSummary: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("got %d workouts, want 1", len(list))
	}
	if list[0].MovingTime != wk.MovingTime {
		t.Errorf("summary moving time = %d, want %d", list[0].MovingTime, wk.MovingTime)
	}
	if list[0].AvgPace != wk.AvgPace {
		t.Errorf("summary pace = %v, want %v", list[0].AvgPace, wk.AvgPace)
	}
}

// A workout imported before pauses existed reads as moving time zero, which is
// the marker for "never worked out" — and a recalculation is what fills it in.
func TestUpdateRefreshesPauses(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, importInput("plain run", "hash-plain"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if wk.MovingTime != wk.Duration {
		t.Fatalf("a workout with no samples should move for its whole duration, got %d", wk.MovingTime)
	}

	wk.HRTimeline = samples([2]int{0, 900}, [2]int{1200, 1800})
	deriveMetrics(wk, 0)
	if err := repo.Update(ctx, wk); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, err := repo.Get(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if len(got.Pauses) != 1 {
		t.Fatalf("pauses after update = %v, want one", got.Pauses)
	}
	if got.MovingTime >= got.Duration {
		t.Errorf("moving time = %d, want less than the elapsed %d", got.MovingTime, got.Duration)
	}
}
