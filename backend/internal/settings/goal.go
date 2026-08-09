package settings

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"
)

// Goal metrics. A goal targets exactly one of these; wanting both a count and a
// distance is two goals, which keeps every tile a single number against a
// single target.
const (
	MetricCount    = "count"    // qualifying activities
	MetricDistance = "distance" // kilometres, summed
	MetricDuration = "duration" // hours, summed
)

// MaxGoalSpan caps how many weeks or months one goal window may cover. Twelve
// is a year of months, and beyond that a "period" stops being something you can
// keep a streak of.
const MaxGoalSpan = 12

// Goal is one training target: `Target` of `Metric` per window of `Span`
// `Period`s — "2 runs a week", "40 km of hiking a month", "30 hours a quarter".
type Goal struct {
	// ID is client-generated and only needs to be unique within a user's list;
	// it exists so the settings editor can key rows across edits.
	ID string `json:"id"`
	// Metric is what gets measured: MetricCount, MetricDistance or
	// MetricDuration.
	Metric string `json:"metric"`
	// Target is the number to reach, in the metric's unit — activities,
	// kilometres or hours.
	Target float64 `json:"target"`
	Period string  `json:"period"` // "week" or "month"
	// Span is how many periods one window covers; 1 for a plain week or month.
	Span int    `json:"span"`
	Type string `json:"type"` // activity type, or "" for any
	// MinKm and MinMinutes are qualifiers on each activity, not on the total:
	// an activity below either is ignored entirely. 0 means no minimum.
	MinKm      float64 `json:"minKm"`
	MinMinutes float64 `json:"minMinutes"`
}

// UnmarshalJSON accepts the stored shape and the one that came before it, where
// every goal was a count and carried `count` instead of `metric`/`target`.
// Normalising on read means nothing downstream — the dashboard, the notifiers,
// this package — has to know two shapes, and the user's next save rewrites the
// row in the current one.
func (g *Goal) UnmarshalJSON(b []byte) error {
	// An alias, so unmarshalling the embedded value does not recurse into here.
	type plain Goal
	var v struct {
		plain
		LegacyCount *int `json:"count"`
	}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*g = Goal(v.plain)
	if g.Metric == "" {
		g.Metric = MetricCount
		if v.LegacyCount != nil {
			g.Target = float64(*v.LegacyCount)
		}
	}
	g.Normalize()
	return nil
}

// Normalize clamps a goal to values the rest of the app can rely on: a known
// metric, a span of at least one period, and no negative numbers.
func (g *Goal) Normalize() {
	switch g.Metric {
	case MetricDistance, MetricDuration:
	default:
		g.Metric = MetricCount
	}
	if g.Period != "month" {
		g.Period = "week"
	}
	if g.Span < 1 {
		g.Span = 1
	}
	if g.Span > MaxGoalSpan {
		g.Span = MaxGoalSpan
	}
	if g.Target < 0 {
		g.Target = 0
	}
	if g.MinKm < 0 {
		g.MinKm = 0
	}
	if g.MinMinutes < 0 {
		g.MinMinutes = 0
	}
}

// Unit is the short label for the goal's metric, used in notification copy.
func (g Goal) Unit() string {
	switch g.Metric {
	case MetricDistance:
		return "km"
	case MetricDuration:
		return "h"
	}
	return ""
}

// FormatAmount renders a value in the goal's unit: counts are whole, distances
// and durations get a decimal only when they need one.
func (g Goal) FormatAmount(v float64) string {
	if g.Metric == MetricCount {
		return fmt.Sprintf("%d", int(v))
	}
	return fmt.Sprintf("%g %s", roundTo(v, 1), g.Unit())
}

// Describe renders a goal the way Settings shows it, e.g. "Hike 40 km a month"
// or "2 runs a week".
//
// Distance and time goals lead with the sport as a verb ("Hike 40 km") rather
// than folding it into a noun phrase: "40 km of hike" needs a gerund per
// activity type to read as English, and that is a table two languages would
// have to keep in step for no gain.
func (g Goal) Describe() string {
	window := "a " + g.Period
	if g.Span > 1 {
		window = fmt.Sprintf("every %d %ss", g.Span, g.Period)
	}
	minimum := g.describeMinimum()
	if g.Metric != MetricCount {
		if g.Type != "" {
			return fmt.Sprintf("%s %s %s%s", g.Type, g.FormatAmount(g.Target), window, minimum)
		}
		return fmt.Sprintf("%s %s%s", g.FormatAmount(g.Target), window, minimum)
	}
	n := int(g.Target)
	noun := "activity"
	if g.Type != "" {
		noun = lower(g.Type)
	}
	if n != 1 {
		noun = "activities"
		if g.Type != "" {
			noun = lower(g.Type) + "s"
		}
	}
	return fmt.Sprintf("%d %s %s%s", n, noun, window, minimum)
}

// describeMinimum renders the per-activity qualifiers as a trailing clause, or
// "" when the goal has none.
func (g Goal) describeMinimum() string {
	var parts []string
	if g.MinKm > 0 {
		parts = append(parts, fmt.Sprintf("%g km", g.MinKm))
	}
	if g.MinMinutes > 0 {
		parts = append(parts, fmt.Sprintf("%g min", g.MinMinutes))
	}
	if len(parts) == 0 {
		return ""
	}
	return " (" + strings.Join(parts, ", ") + "+ only)"
}

func lower(s string) string {
	out := []rune(s)
	for i, r := range out {
		if r >= 'A' && r <= 'Z' {
			out[i] = r + 32
		}
	}
	return string(out)
}

// floorMod is `a % n` with a result that is never negative, so windows tile
// consistently on either side of the anchor.
func floorMod(a, n int) int {
	return ((a % n) + n) % n
}

func roundTo(v float64, places int) float64 {
	pow := 1.0
	for i := 0; i < places; i++ {
		pow *= 10
	}
	return float64(int64(v*pow+0.5)) / pow
}

// goalEpochYear/Month/Day is the Monday multi-week windows are counted from.
// Multi-period windows have to be anchored to something fixed rather than to
// "now", or the block a workout falls into would change from one day to the
// next and streaks would be meaningless. Any Monday would do; this is the first
// one of the Unix epoch, which is the same choice the frontend makes.
const (
	goalEpochYear  = 1970
	goalEpochMonth = time.January
	goalEpochDay   = 5
)

// PeriodStart is the first day of the window `now` falls into.
//
// For a span of one this is simply the Monday of this week or the first of this
// month. For longer spans, windows tile forward from a fixed anchor — the epoch
// Monday for weeks, January for months — so consecutive windows never overlap
// and each one ends exactly where the next begins.
func (g Goal) PeriodStart(now time.Time) time.Time {
	span := g.Span
	if span < 1 {
		span = 1
	}
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, now.Location())
	if g.Period == "month" {
		months := y*12 + int(m) - 1
		start := months - floorMod(months, span)
		return time.Date(start/12, time.Month(start%12+1), 1, 0, 0, 0, 0, now.Location())
	}
	// Go's Sunday-first weekday needs shifting to a Monday-anchored week.
	monday := today.AddDate(0, 0, -((int(today.Weekday()) + 6) % 7))
	if span > 1 {
		// Whole weeks since the anchor, floored to a multiple of the span. The
		// anchor is built in the same location, and the elapsed hours are
		// rounded to whole days, so a DST shift between the two cannot move a
		// window by a week.
		epoch := time.Date(goalEpochYear, goalEpochMonth, goalEpochDay, 0, 0, 0, 0, now.Location())
		weeks := int(math.Round(monday.Sub(epoch).Hours()/24)) / 7
		monday = monday.AddDate(0, 0, -7*floorMod(weeks, span))
	}
	return monday
}

// PeriodEnd is the first instant of the window after the one containing `now`.
func (g Goal) PeriodEnd(now time.Time) time.Time {
	start := g.PeriodStart(now)
	if g.Period == "month" {
		return start.AddDate(0, g.Span, 0)
	}
	return start.AddDate(0, 0, 7*g.Span)
}

// PeriodKey identifies the current window, so a notification dedupe key resets
// when it rolls over.
func (g Goal) PeriodKey(now time.Time) string {
	return g.PeriodStart(now).Format("2006-01-02")
}
