package workout

import (
	"testing"
	"time"
)

var recordsNow = time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)

func rec(id, date string, t Type, f func(*Workout)) Workout {
	start, _ := time.Parse("2006-01-02", date)
	w := Workout{ID: id, Name: id, Type: t, Date: date, StartTime: start, Duration: 1800, Distance: 5000}
	if f != nil {
		f(&w)
	}
	return w
}

func labels(rs []Record) map[string]string {
	out := map[string]string{}
	for _, r := range rs {
		out[r.Label] = r.Value
	}
	return out
}

// Judging a hike against hikes is right — a hike is not slow for being slower
// than a run — but the label has to say which sport, or it reads as a claim
// about all of someone's training.
func TestRecordLabelsNameTheSport(t *testing.T) {
	ws := []Workout{
		rec("new", "2026-08-24", TypeHike, func(w *Workout) { w.Distance = 20000 }),
		rec("a", "2026-08-01", TypeHike, nil),
		rec("b", "2026-07-01", TypeHike, nil),
		rec("c", "2026-06-01", TypeHike, nil),
	}
	got := labels(RecentPersonalBests(ws, recordsNow))
	if got["Longest Hike"] != "20.0 km" {
		t.Fatalf("want a Longest Hike record, got %v", got)
	}
}

// A morning run and an evening hike each set their own, against different
// peers. Only the later one used to be judged at all.
func TestRecordsFromEveryWorkoutOnTheLatestDay(t *testing.T) {
	ws := []Workout{
		rec("hike-new", "2026-08-24", TypeHike, func(w *Workout) {
			w.Distance = 20000
			w.StartTime = time.Date(2026, 8, 24, 17, 0, 0, 0, time.UTC)
		}),
		rec("h1", "2026-08-01", TypeHike, nil), rec("h2", "2026-07-01", TypeHike, nil), rec("h3", "2026-06-01", TypeHike, nil),
		rec("run-new", "2026-08-24", TypeRun, func(w *Workout) {
			w.AvgPace = 400
			w.StartTime = time.Date(2026, 8, 24, 8, 0, 0, 0, time.UTC)
		}),
		rec("r1", "2026-08-02", TypeRun, func(w *Workout) { w.AvgPace = 460 }),
		rec("r2", "2026-07-02", TypeRun, func(w *Workout) { w.AvgPace = 455 }),
		rec("r3", "2026-06-02", TypeRun, func(w *Workout) { w.AvgPace = 470 }),
	}
	got := labels(RecentPersonalBests(ws, recordsNow))
	if _, ok := got["Longest Hike"]; !ok {
		t.Errorf("lost the hike's record: %v", got)
	}
	if got["Fastest Run pace"] != "6:40 /km" {
		t.Errorf("lost or mis-stated the run's record: %v", got)
	}
}

// A ride reports speed and no pace, so a function that only looked at pace gave
// half the sports the app supports no record at all.
func TestSpeedRecordForSportsWithoutPace(t *testing.T) {
	ws := []Workout{
		rec("new", "2026-08-24", TypeRide, func(w *Workout) { w.AvgSpeed = 31; w.Distance = 100 }),
		rec("a", "2026-08-01", TypeRide, func(w *Workout) { w.AvgSpeed = 26; w.Distance = 100 }),
		rec("b", "2026-07-01", TypeRide, func(w *Workout) { w.AvgSpeed = 28; w.Distance = 100 }),
		rec("c", "2026-06-01", TypeRide, func(w *Workout) { w.AvgSpeed = 24; w.Distance = 100 }),
	}
	got := labels(RecentPersonalBests(ws, recordsNow))
	if got["Fastest Ride"] != "31.0 km/h" {
		t.Fatalf("want a speed record, got %v", got)
	}
}

// Going slowly must not look like getting fitter: the record is heart rate per
// unit of speed, not heart rate.
func TestEfficiencyRecordIsNotJustALowHeartRate(t *testing.T) {
	slow := []Workout{
		rec("new", "2026-08-24", TypeRun, func(w *Workout) { w.AvgHR = 100; w.AvgSpeed = 5; w.Distance = 100 }),
		rec("a", "2026-08-01", TypeRun, func(w *Workout) { w.AvgHR = 140; w.AvgSpeed = 10; w.Distance = 100 }),
		rec("b", "2026-07-01", TypeRun, func(w *Workout) { w.AvgHR = 155; w.AvgSpeed = 11; w.Distance = 100 }),
		rec("c", "2026-06-01", TypeRun, func(w *Workout) { w.AvgHR = 145; w.AvgSpeed = 10; w.Distance = 100 }),
	}
	if _, ok := labels(RecentPersonalBests(slow, recordsNow))["Best Run efficiency"]; ok {
		t.Fatal("the slowest workout was called the most efficient")
	}
}

// An import of last year's history is not a personal-best alert.
func TestStaleWorkoutsAreNotNews(t *testing.T) {
	ws := []Workout{
		rec("new", "2025-08-24", TypeHike, func(w *Workout) { w.Distance = 20000 }),
		rec("a", "2025-08-01", TypeHike, nil), rec("b", "2025-07-01", TypeHike, nil), rec("c", "2025-06-01", TypeHike, nil),
	}
	if got := RecentPersonalBests(ws, recordsNow); len(got) != 0 {
		t.Fatalf("want nothing for a year-old workout, got %v", labels(got))
	}
}

// Being the longest of two is not an achievement worth interrupting anyone for.
func TestTooFewPeersMeansNoRecord(t *testing.T) {
	ws := []Workout{
		rec("new", "2026-08-24", TypeHike, func(w *Workout) { w.Distance = 20000 }),
		rec("a", "2026-08-01", TypeHike, nil),
	}
	if got := RecentPersonalBests(ws, recordsNow); len(got) != 0 {
		t.Fatalf("want nothing with two peers, got %v", labels(got))
	}
}
