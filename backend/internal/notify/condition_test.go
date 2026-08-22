package notify

import (
	"context"
	"testing"
)

// The bug this exists to prevent.
//
// A goal that was already complete the first time anyone looked used to be
// announced by whatever workout happened to run the next check — one ride,
// three notifications, none of them about the ride. A first sighting is a
// baseline: it is recorded, and it is not news.
func TestFirstSightingIsNeverNews(t *testing.T) {
	svc := newTestService(t, Prefs{})
	ctx := context.Background()

	if svc.Crossed(ctx, alice, "goal-met:a:2026-W34", true) {
		t.Fatal("a condition already true when first seen was reported as a crossing")
	}
	// And it stays recorded: the same standing condition is not news later.
	if svc.Crossed(ctx, alice, "goal-met:a:2026-W34", true) {
		t.Fatal("a standing condition was reported as a crossing")
	}
}

func TestCrossingIsReportedOnce(t *testing.T) {
	svc := newTestService(t, Prefs{})
	ctx := context.Background()
	key := "goal-met:a:2026-W34"

	// Seen short of target first, which is the ordinary case: the goal existed
	// before it was met.
	if svc.Crossed(ctx, alice, key, false) {
		t.Fatal("a false condition was reported as a crossing")
	}
	if !svc.Crossed(ctx, alice, key, true) {
		t.Fatal("becoming true was not reported as a crossing")
	}
	if svc.Crossed(ctx, alice, key, true) {
		t.Fatal("staying true was reported as a crossing again")
	}
}

// A workout deleted takes a goal back under its target; earning it again
// inside the same period is a real completion and says so. Under the old
// dedupe-key scheme the second one was silent forever.
func TestFallingBackRearms(t *testing.T) {
	svc := newTestService(t, Prefs{})
	ctx := context.Background()
	key := "goal-met:a:2026-W34"

	svc.Crossed(ctx, alice, key, false)
	if !svc.Crossed(ctx, alice, key, true) {
		t.Fatal("first crossing not reported")
	}
	if svc.Crossed(ctx, alice, key, false) {
		t.Fatal("falling back was reported as a crossing")
	}
	if !svc.Crossed(ctx, alice, key, true) {
		t.Fatal("earning it again was not reported")
	}
}

// The state is nobody's notification, which is the other half of the fix:
// emptying the notification list used to re-arm every standing condition,
// because the marker was the notification.
func TestClearingNotificationsDoesNotRearm(t *testing.T) {
	svc := newTestService(t, Prefs{})
	ctx := context.Background()
	key := "goal-met:a:2026-W34"

	svc.Crossed(ctx, alice, key, false)
	if !svc.Crossed(ctx, alice, key, true) {
		t.Fatal("first crossing not reported")
	}
	svc.Notify(ctx, Event{UserID: alice, Kind: KindGoalMet, Title: "Goal complete"})
	if err := svc.DeleteAll(ctx, alice); err != nil {
		t.Fatalf("DeleteAll() error = %v", err)
	}
	if svc.Crossed(ctx, alice, key, true) {
		t.Fatal("clearing the notification list re-armed a standing condition")
	}
}

// Each period is its own condition, so a goal met last week is news again when
// it is met this week.
func TestEachPeriodIsItsOwnCondition(t *testing.T) {
	svc := newTestService(t, Prefs{})
	ctx := context.Background()

	svc.Crossed(ctx, alice, "goal-met:a:2026-W34", false)
	if !svc.Crossed(ctx, alice, "goal-met:a:2026-W34", true) {
		t.Fatal("first crossing not reported")
	}
	// A new week starts at false whatever last week ended at, so the first
	// check of it records the baseline rather than announcing.
	if svc.Crossed(ctx, alice, "goal-met:a:2026-W35", false) {
		t.Fatal("a new period's baseline was reported as a crossing")
	}
	if !svc.Crossed(ctx, alice, "goal-met:a:2026-W35", true) {
		t.Fatal("the new period's crossing was not reported")
	}
}
