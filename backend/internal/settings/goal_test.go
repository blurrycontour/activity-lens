package settings

import (
	"encoding/json"
	"testing"
	"time"
)

// A goal saved before goals could measure distance or time has no "metric" and
// carries its target in "count". Reading it back must produce a working count
// goal rather than a goal with a target of zero, which the dashboard would
// render as 0/0 and every notifier would skip.
func TestGoalDecodesTheShapeThatCameBefore(t *testing.T) {
	var g Goal
	if err := json.Unmarshal([]byte(`{"id":"a","count":3,"period":"month","type":"Run","minKm":5}`), &g); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if g.Metric != MetricCount || g.Target != 3 {
		t.Errorf("legacy goal decoded as metric=%q target=%v, want count/3", g.Metric, g.Target)
	}
	if g.Span != 1 {
		t.Errorf("span = %d, want 1 — a missing span is a plain single period", g.Span)
	}
	if g.Period != "month" || g.Type != "Run" || g.MinKm != 5 {
		t.Errorf("legacy goal lost a field: %+v", g)
	}
}

// Decoding also normalizes, so nothing downstream has to defend against a span
// of zero or a metric it has never heard of.
func TestGoalDecodeNormalizes(t *testing.T) {
	var g Goal
	if err := json.Unmarshal([]byte(`{"metric":"bananas","target":5,"period":"fortnight","span":0}`), &g); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if g.Metric != MetricCount || g.Period != "week" || g.Span != 1 {
		t.Errorf("unnormalized goal: %+v", g)
	}
}

// Multi-period windows tile forward from a fixed anchor rather than being
// measured back from "now". These are the same dates the frontend's
// insights.test.ts pins: the two implementations both decide which window a
// workout belongs to, and a disagreement would show the dashboard one number
// while the "goal met" notification used another.
func TestPeriodStartTilesFromAFixedAnchor(t *testing.T) {
	day := func(s string) time.Time {
		d, err := time.ParseInLocation("2006-01-02", s, time.UTC)
		if err != nil {
			t.Fatal(err)
		}
		return d
	}
	threeWeeks := Goal{Period: "week", Span: 3}
	for _, date := range []string{"2026-07-13", "2026-07-27", "2026-08-02"} {
		if got := threeWeeks.PeriodStart(day(date)).Format("2006-01-02"); got != "2026-07-13" {
			t.Errorf("3-week window of %s = %s, want 2026-07-13", date, got)
		}
	}
	if got := threeWeeks.PeriodStart(day("2026-08-03")).Format("2006-01-02"); got != "2026-08-03" {
		t.Errorf("the next block starts at %s, want 2026-08-03", got)
	}

	twoMonths := Goal{Period: "month", Span: 2}
	for date, want := range map[string]string{
		"2026-01-15": "2026-01-01",
		"2026-02-28": "2026-01-01",
		"2026-03-01": "2026-03-01",
		"2026-12-31": "2026-11-01",
	} {
		if got := twoMonths.PeriodStart(day(date)).Format("2006-01-02"); got != want {
			t.Errorf("2-month window of %s = %s, want %s", date, got, want)
		}
	}
}

// A span of one has to behave exactly as it did before spans existed, or every
// goal anyone already set quietly changes meaning on upgrade.
func TestSinglePeriodStartIsUnchanged(t *testing.T) {
	wed := time.Date(2026, 7, 29, 10, 0, 0, 0, time.UTC)
	if got := (Goal{Period: "week", Span: 1}).PeriodStart(wed).Format("2006-01-02"); got != "2026-07-27" {
		t.Errorf("week start = %s, want the Monday 2026-07-27", got)
	}
	if got := (Goal{Period: "month", Span: 1}).PeriodStart(wed).Format("2006-01-02"); got != "2026-07-01" {
		t.Errorf("month start = %s, want 2026-07-01", got)
	}
}

func TestGoalDescribe(t *testing.T) {
	for _, tc := range []struct {
		goal Goal
		want string
	}{
		{Goal{Metric: MetricCount, Target: 2, Period: "week", Span: 1, Type: "Run"}, "2 runs a week"},
		{Goal{Metric: MetricCount, Target: 1, Period: "week", Span: 1}, "1 activity a week"},
		{Goal{Metric: MetricCount, Target: 3, Period: "week", Span: 1, MinKm: 5}, "3 5 km+ activities a week"},
		{Goal{Metric: MetricDistance, Target: 40, Period: "month", Span: 1, Type: "Hike"}, "Hike 40 km a month"},
		{Goal{Metric: MetricDuration, Target: 30, Period: "month", Span: 2, Type: "Run"}, "Run 30 h every 2 months"},
		{Goal{Metric: MetricDistance, Target: 25, Period: "week", Span: 3}, "25 km every 3 weeks"},
	} {
		if got := tc.goal.Describe(); got != tc.want {
			t.Errorf("Describe() = %q, want %q", got, tc.want)
		}
	}
}
