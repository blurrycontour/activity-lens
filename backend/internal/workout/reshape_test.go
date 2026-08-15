package workout

import (
	"math"
	"testing"
	"time"
)

// Trimming rewrites recorded data, which is the one thing in this app that
// cannot be re-derived from anything else on the row. Every case here is a
// silently wrong number rather than a failure: a series that keeps its original
// timestamps draws a chart starting at 4:00, a route trimmed by the wrong rule
// reports a distance nobody ran, and a pause left outside the window makes the
// moving time longer than the workout.

func reshapeSubject() *Workout {
	w := &Workout{
		ID:        "w1",
		StartTime: time.Date(2026, 5, 4, 7, 0, 0, 0, time.UTC),
		Duration:  600,
		Distance:  2000,
		AvgHR:     150,
		MaxHR:     170,
	}
	// One sample every 60s, and a route point beside each: the shape a normal
	// GPX produces, where the elevation series times the route.
	for t := 0; t <= 600; t += 60 {
		w.HRTimeline = append(w.HRTimeline, HRPoint{T: t, HR: 140 + t/60})
		w.ElevTimeline = append(w.ElevTimeline, ElevPoint{T: t, Elev: 10 + t/60})
		w.CadenceTimeline = append(w.CadenceTimeline, CadencePoint{T: t, Cad: 80})
		// ~111 m of latitude per 0.001°, so each step is a known distance.
		w.Route = append(w.Route, LatLng{51.5 + float64(t/60)*0.001, -0.12})
	}
	return w
}

func TestTrimKeepsTheWindowAndRebasesIt(t *testing.T) {
	w := reshapeSubject()
	applyReshape(w, Reshape{Start: 120, End: 480})

	if w.Duration != 360 {
		t.Errorf("duration = %d, want 360", w.Duration)
	}
	// The start moves with the window; leaving it put would date the workout to
	// a moment it no longer contains.
	if want := time.Date(2026, 5, 4, 7, 2, 0, 0, time.UTC); !w.StartTime.Equal(want) {
		t.Errorf("start = %v, want %v", w.StartTime, want)
	}
	if len(w.HRTimeline) != 7 {
		t.Fatalf("kept %d heart-rate samples, want 7", len(w.HRTimeline))
	}
	// Rebased, not merely filtered: a chart reads T as "seconds in".
	if w.HRTimeline[0].T != 0 {
		t.Errorf("first sample at T=%d, want 0", w.HRTimeline[0].T)
	}
	if last := w.HRTimeline[len(w.HRTimeline)-1].T; last != 360 {
		t.Errorf("last sample at T=%d, want 360", last)
	}
	if len(w.Route) != 7 {
		t.Errorf("kept %d route points, want 7", len(w.Route))
	}
	// Six 0.001° steps of latitude, about 111 m each.
	if w.Distance < 600 || w.Distance > 700 {
		t.Errorf("distance = %.0f m, want roughly 667", w.Distance)
	}
}

// Without a route there is nothing to measure, so the distance follows the
// clock. A treadmill run trimmed by a fifth is a fifth shorter.
func TestTrimScalesDistanceWithoutARoute(t *testing.T) {
	w := reshapeSubject()
	w.Route = nil
	applyReshape(w, Reshape{Start: 0, End: 300})

	if math.Abs(w.Distance-1000) > 1 {
		t.Errorf("distance = %.1f, want 1000 (half of 2000 over half the time)", w.Distance)
	}
}

func TestTrimClipsPausesToTheWindow(t *testing.T) {
	w := reshapeSubject()
	w.Pauses = []Pause{
		{From: 30, To: 90},   // straddles the new start
		{From: 200, To: 240}, // inside
		{From: 550, To: 590}, // outside entirely
	}
	applyReshape(w, Reshape{Start: 60, End: 300})

	want := []Pause{{From: 0, To: 30}, {From: 140, To: 180}}
	if len(w.Pauses) != len(want) {
		t.Fatalf("pauses = %v, want %v", w.Pauses, want)
	}
	for i := range want {
		if w.Pauses[i] != want[i] {
			t.Errorf("pause %d = %v, want %v", i, w.Pauses[i], want[i])
		}
	}
}

func TestDropRemovesTheSeriesAndWhatItFed(t *testing.T) {
	w := reshapeSubject()
	applyReshape(w, Reshape{Drop: []Stream{StreamHeartRate, StreamCadence}})

	if w.HRTimeline != nil || w.CadenceTimeline != nil {
		t.Error("a dropped series is still on the workout")
	}
	// The averages are the whole reason this is not just hiding a chart: a
	// workout that reports 150 bpm with no heart-rate data is worse than one
	// that reports none.
	if w.AvgHR != 0 || w.MaxHR != 0 {
		t.Errorf("avg/max HR = %d/%d, want 0/0 after dropping heart rate", w.AvgHR, w.MaxHR)
	}
	// Untouched neighbours.
	if len(w.ElevTimeline) == 0 || len(w.Route) == 0 {
		t.Error("dropping one series took another with it")
	}
}

// Distance survives a dropped route: it is still how far you went, and it is
// the one number that cannot be recovered once the coordinates are gone.
func TestDropRouteKeepsDistance(t *testing.T) {
	w := reshapeSubject()
	applyReshape(w, Reshape{Drop: []Stream{StreamRoute}})
	if w.Route != nil {
		t.Error("route survived being dropped")
	}
	if w.Distance != 2000 {
		t.Errorf("distance = %.0f, want the recorded 2000", w.Distance)
	}
}

// The route carries no timestamps of its own, so a file whose other series do
// not line up with it falls back to spreading the points evenly. The trim still
// has to keep roughly the right half rather than all of it or none.
func TestTrimTimesARouteWithNoMatchingSeries(t *testing.T) {
	w := reshapeSubject()
	// A pace series is filtered by the importer, so it is never 1:1 with the
	// route; clear the two that are, to reach the fallback.
	w.ElevTimeline = nil
	w.HRTimeline = nil
	applyReshape(w, Reshape{Start: 0, End: 300})

	if len(w.Route) != 6 {
		t.Errorf("kept %d route points, want 6 of 11 for the first half", len(w.Route))
	}
}

func TestReshapeValidation(t *testing.T) {
	cases := []struct {
		name    string
		r       Reshape
		wantErr bool
	}{
		{"a normal window", Reshape{Start: 10, End: 500}, false},
		{"an open end", Reshape{Start: 10}, false},
		{"nothing left", Reshape{Start: 300, End: 305}, true},
		{"inverted", Reshape{Start: 400, End: 100}, true},
		{"negative", Reshape{Start: -5}, true},
		{"an end past the workout is clamped, not refused", Reshape{End: 9000}, false},
		{"an unknown series", Reshape{Drop: []Stream{"nonsense"}}, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if err := c.r.Validate(600); (err != nil) != c.wantErr {
				t.Errorf("Validate() error = %v, wantErr %v", err, c.wantErr)
			}
		})
	}
}
