package workout

import (
	"fmt"
	"sort"
	"time"
)

// RecordKind names the measure a personal best was set on.
type RecordKind string

const (
	RecordDistance   RecordKind = "distance"
	RecordDuration   RecordKind = "duration"
	RecordPace       RecordKind = "pace"
	RecordSpeed      RecordKind = "speed"
	RecordElevation  RecordKind = "elevation"
	RecordEfficiency RecordKind = "efficiency"
)

// Record is one personal best, already worded for a reader.
type Record struct {
	Workout *Workout
	Kind    RecordKind
	// Label names the measure *and* the sport: judging a hike against hikes is
	// right, but an unqualified "Fastest pace" beside a hiking pace reads as a
	// claim about all of someone's training.
	Label string
	Value string
}

// MinSameType is how many earlier activities of a sport there must be before a
// result counts as a record. Being the longest of two is not an achievement.
const MinSameType = 3

// MaxRecordAgeDays bounds how stale the latest workout may be before its
// records stop being news. An import of last year's history is not a PB alert.
const MaxRecordAgeDays = 14

/*
RecentPersonalBests reports the records set by the latest day's activities.

A deliberate mirror of recentPersonalBests in the frontend's lib/insights.ts,
because the two answer the same question for different audiences: that one
draws the dashboard banner, this one decides whether to interrupt someone. They
are kept in step by hand, and the behaviours worth preserving are the ones with
tests either side — same-sport comparison, every workout on the latest day
rather than only the last, and the three measures deliberately excluded.

Not records here, and for reasons rather than by omission: highest max heart
rate is a ceiling rather than an accomplishment and a notification celebrating
one is an invitation to chase it; lowest average heart rate rewards going
slowly, which is what the efficiency measure is for; calories and steps track
duration and distance closely enough to say the same thing twice.
*/
func RecentPersonalBests(ws []Workout, now time.Time) []Record {
	if len(ws) == 0 {
		return nil
	}
	sorted := make([]*Workout, len(ws))
	for i := range ws {
		sorted[i] = &ws[i]
	}
	// Date is a day, so it ties for anything recorded on the same one;
	// StartTime breaks it. Without that, "the latest workout" was whichever
	// order the store happened to return.
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Date != sorted[j].Date {
			return sorted[i].Date > sorted[j].Date
		}
		return sorted[i].StartTime.After(sorted[j].StartTime)
	})

	latestDay := sorted[0].Date
	day, err := time.Parse("2006-01-02", latestDay)
	if err != nil || now.Sub(day) > MaxRecordAgeDays*24*time.Hour {
		return nil
	}

	var out []Record
	for _, w := range sorted {
		if w.Date != latestDay {
			break
		}
		out = append(out, bestsFor(w, ws)...)
	}
	return out
}

// bestsFor measures one workout against every other of its own type.
func bestsFor(w *Workout, all []Workout) []Record {
	peers := make([]*Workout, 0, len(all))
	for i := range all {
		if all[i].Type == w.Type && all[i].ID != w.ID {
			peers = append(peers, &all[i])
		}
	}
	if len(peers) < MinSameType {
		return nil
	}

	var out []Record
	add := func(kind RecordKind, label, value string) {
		out = append(out, Record{Workout: w, Kind: kind, Label: label, Value: value})
	}
	sport := string(w.Type)

	if w.Distance > 0 && bestBy(peers, func(p *Workout) bool { return w.Distance > p.Distance }) {
		add(RecordDistance, "Longest "+sport, fmt.Sprintf("%.1f km", w.Distance/1000))
	}
	if w.Duration > 0 && bestBy(peers, func(p *Workout) bool { return w.Duration > p.Duration }) {
		add(RecordDuration, "Longest "+sport+" time", fmtDurationShort(w.Duration))
	}
	// Pace and speed are the same claim in different units. Foot activities are
	// naturally read as pace; rides and swims remain speed-based even though a
	// ride also stores pace for its detail statistics.
	if onFoot(w.Type) && w.AvgPace > 0 {
		paced := filter(peers, func(p *Workout) bool { return p.AvgPace > 0 })
		if len(paced) >= MinSameType && bestBy(paced, func(p *Workout) bool { return w.AvgPace < p.AvgPace }) {
			add(RecordPace, "Fastest "+sport+" pace", fmtPace(w.AvgPace))
		}
	} else if w.AvgSpeed > 0 {
		fast := filter(peers, func(p *Workout) bool { return p.AvgSpeed > 0 })
		if len(fast) >= MinSameType && bestBy(fast, func(p *Workout) bool { return w.AvgSpeed > p.AvgSpeed }) {
			add(RecordSpeed, "Fastest "+sport, fmt.Sprintf("%.1f km/h", w.AvgSpeed))
		}
	}
	if w.ElevationGain > 100 && bestBy(peers, func(p *Workout) bool { return w.ElevationGain > p.ElevationGain }) {
		add(RecordElevation, "Most "+sport+" climbing", fmt.Sprintf("%.0f m", w.ElevationGain))
	}
	// Heartbeats per km/h of speed: the one record that cannot be had by trying
	// harder on the day. It falls when the same effort starts buying more speed.
	if ef := efficiency(w); ef > 0 {
		rated := filter(peers, func(p *Workout) bool { return efficiency(p) > 0 })
		if len(rated) >= MinSameType && bestBy(rated, func(p *Workout) bool { return ef < efficiency(p) }) {
			add(RecordEfficiency, "Best "+sport+" efficiency", fmt.Sprintf("%.1f bpm/kph", ef))
		}
	}
	return out
}

func efficiency(w *Workout) float64 {
	if w.AvgHR <= 0 || w.AvgSpeed <= 0 {
		return 0
	}
	return float64(w.AvgHR) / w.AvgSpeed
}

func bestBy(peers []*Workout, beats func(*Workout) bool) bool {
	for _, p := range peers {
		if !beats(p) {
			return false
		}
	}
	return true
}

func filter(ws []*Workout, keep func(*Workout) bool) []*Workout {
	out := ws[:0:0]
	for _, w := range ws {
		if keep(w) {
			out = append(out, w)
		}
	}
	return out
}

func fmtPace(secPerKm float64) string {
	return fmt.Sprintf("%d:%02d /km", int(secPerKm)/60, int(secPerKm+0.5)%60)
}

func fmtDurationShort(sec int) string {
	if sec >= 3600 {
		return fmt.Sprintf("%dh %dm", sec/3600, (sec%3600+30)/60)
	}
	return fmt.Sprintf("%dm", (sec+30)/60)
}
