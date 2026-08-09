package httpapi

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/equipment"
	"github.com/blurrycontour/activity-lens/backend/internal/notify"
	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/auth"
)

// This file holds everything that decides a notification is warranted. Keeping
// the producers together, rather than scattered through the handlers, makes the
// full set of things that can interrupt a user readable in one place.

// notifyWorkoutShared tells the recipient that someone shared a workout.
func (s *Server) notifyWorkoutShared(r *http.Request, sender auth.User, targetID int64, wk *workout.Workout) {
	from := sender.DisplayName
	if from == "" {
		from = sender.Username
	}
	s.notify.Notify(r.Context(), notify.Event{
		UserID: targetID,
		Kind:   notify.KindWorkoutShared,
		Title:  fmt.Sprintf("%s shared a workout with you", from),
		Body:   fmt.Sprintf("%s · %s", wk.Name, summarizeWorkout(wk)),
		Link:   "/workouts/" + wk.ID,
		// A share came from a person, so it wears their face rather than ours —
		// their upload, or the avatar generated from their username.
		Icon: effectiveAvatar(sender),
		// No dedupe key: each share is a distinct event, and re-sharing after
		// a revoke should notify again.
	})
}

// summarizeWorkout renders the one-line "5.02 km · 28:14" body of a share
// notification.
func summarizeWorkout(wk *workout.Workout) string {
	parts := make([]string, 0, 2)
	if wk.Distance >= 1000 {
		parts = append(parts, fmt.Sprintf("%.2f km", wk.Distance/1000))
	} else if wk.Distance > 0 {
		parts = append(parts, fmt.Sprintf("%.0f m", wk.Distance))
	}
	if wk.Duration > 0 {
		d := time.Duration(wk.Duration) * time.Second
		if d >= time.Hour {
			parts = append(parts, fmt.Sprintf("%d:%02d:%02d", int(d.Hours()), int(d.Minutes())%60, int(d.Seconds())%60))
		} else {
			parts = append(parts, fmt.Sprintf("%d:%02d", int(d.Minutes()), int(d.Seconds())%60))
		}
	}
	if len(parts) == 0 {
		return string(wk.Type)
	}
	return fmt.Sprintf("%s · %s", wk.Type, joinDot(parts))
}

func joinDot(parts []string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += " · "
		}
		out += p
	}
	return out
}

// afterWorkoutRecorded runs the checks that a new workout can newly satisfy:
// gear crossing its replace-at distance, and a training goal being met.
//
// It is deliberately best-effort and logged rather than returned — an import
// must not fail because a notification could not be evaluated.
func (s *Server) afterWorkoutRecorded(r *http.Request, userID int64) {
	// Detached from the request so the checks survive the response being
	// written; they are not something the client waits for.
	ctx := context.WithoutCancel(r.Context())
	s.checkGearWear(ctx, userID)
	s.checkGoals(ctx, userID)
	// The import path only marks a workout as owed a lookup; this tells the
	// scheduler not to wait for its next tick. Here rather than in the import
	// handler for the same reason the goal checks are: a bulk import skips this
	// per file and calls it once from finalize, so one nudge covers the batch.
	s.NudgeWeather()
}

// checkGearWear notifies once per item when it passes its replace-at distance.
// The dedupe key is the equipment id, so a shoe that stays over the line does
// not re-notify after every subsequent run.
func (s *Server) checkGearWear(ctx context.Context, userID int64) {
	items, err := s.equipment.List(ctx, userID)
	if err != nil {
		slog.Warn("gear wear check failed", "user_id", userID, "error", err)
		return
	}
	for _, e := range items {
		limitKm := e.RetireAtKm
		if limitKm <= 0 {
			limitKm = equipment.DefaultRetireKm(e.Type)
		}
		key := "gear:" + e.ID
		if limitKm <= 0 {
			continue
		}
		usedKm := e.TotalDistance / 1000
		if usedKm < limitKm {
			// Below the line — clear any previous marker so a replaced item can
			// notify again once it wears out in turn.
			s.notify.Resolved(ctx, userID, key)
			continue
		}
		s.notify.Notify(ctx, notify.Event{
			UserID:    userID,
			Kind:      notify.KindGearWorn,
			Title:     e.Name + " is due for replacement",
			Body:      fmt.Sprintf("%.0f km of a %.0f km life", usedKm, limitKm),
			Link:      "/equipment",
			DedupeKey: key,
		})
	}
}

// checkGoals notifies when a goal is met for the current period. The dedupe key
// includes the period, so each new week or month can fire again.
func (s *Server) checkGoals(ctx context.Context, userID int64) {
	prefs, err := s.settings.UserPreferences(ctx, userID)
	if err != nil || len(prefs.Goals) == 0 {
		return
	}
	workouts, err := s.workout.ListSummary(ctx, userID)
	if err != nil {
		slog.Warn("goal check failed", "user_id", userID, "error", err)
		return
	}
	now := time.Now()
	for _, g := range prefs.Goals {
		if g.Target <= 0 {
			continue
		}
		done := progressTowardGoal(workouts, g, now)
		if done < g.Target {
			continue
		}
		s.notify.Notify(ctx, notify.Event{
			UserID:    userID,
			Kind:      notify.KindGoalMet,
			Title:     "Goal complete: " + g.Describe(),
			Body:      fmt.Sprintf("%s of %s done this %s", g.FormatAmount(done), g.FormatAmount(g.Target), g.Period),
			Link:      "/",
			DedupeKey: fmt.Sprintf("goal-met:%s:%s", g.ID, g.PeriodKey(now)),
		})
	}
}

// checkGoalsAtRisk warns when a goal's period is nearly over and still short.
// Unlike the other producers this is time-driven, so it runs from the daily
// ticker rather than off the back of a workout.
func (s *Server) checkGoalsAtRisk(ctx context.Context, userID int64) {
	prefs, err := s.settings.UserPreferences(ctx, userID)
	if err != nil || len(prefs.Goals) == 0 {
		return
	}
	workouts, err := s.workout.ListSummary(ctx, userID)
	if err != nil {
		return
	}
	now := time.Now()
	for _, g := range prefs.Goals {
		if g.Target <= 0 || !nearPeriodEnd(g, now) {
			continue
		}
		done := progressTowardGoal(workouts, g, now)
		if done >= g.Target {
			continue
		}
		s.notify.Notify(ctx, notify.Event{
			UserID: userID,
			Kind:   notify.KindGoalAtRisk,
			Title:  fmt.Sprintf("%s to go: %s", g.FormatAmount(g.Target-done), g.Describe()),
			Body:   fmt.Sprintf("This %s is nearly over and you are at %s of %s.", g.Period, g.FormatAmount(done), g.FormatAmount(g.Target)),
			Link:   "/",
			// One warning per goal per period.
			DedupeKey: fmt.Sprintf("goal-risk:%s:%s", g.ID, g.PeriodKey(now)),
		})
	}
}

// progressTowardGoal sums the goal's metric over the qualifying activities in
// its current window: activities, kilometres, or hours.
//
// The distance test compares the *displayed* distance, rounded to one decimal
// place, rather than raw metres — a GPS run shown everywhere in the app as
// "5.0 km" is typically stored as about 4,983 m, and a goal that rejected it
// while the UI called it 5 km would simply look broken. This mirrors the same
// rule in the frontend's insights module.
func progressTowardGoal(workouts []workout.Workout, g settings.Goal, now time.Time) float64 {
	start := g.PeriodStart(now)
	total := 0.0
	for _, w := range workouts {
		if w.StartTime.Before(start) {
			continue
		}
		if g.Type != "" && string(w.Type) != g.Type {
			continue
		}
		if g.MinKm > 0 && math.Round(w.Distance/100)/10 < g.MinKm {
			continue
		}
		if g.MinMinutes > 0 && float64(w.Duration)/60 < g.MinMinutes {
			continue
		}
		switch g.Metric {
		case settings.MetricDistance:
			total += w.Distance / 1000
		case settings.MetricDuration:
			total += float64(w.Duration) / 3600
		default:
			total++
		}
	}
	return total
}

// nearPeriodEnd reports whether there is little enough of the window left that
// a warning is actionable rather than premature: the last two days of a week,
// or the last four of a month. A multi-period window is judged by its own end,
// so a "3 weeks" goal is only flagged in the final days of the third week.
func nearPeriodEnd(g settings.Goal, now time.Time) bool {
	left := g.PeriodEnd(now).Sub(now)
	if g.Period == "month" {
		return left <= 4*24*time.Hour
	}
	return left <= 2*24*time.Hour
}
