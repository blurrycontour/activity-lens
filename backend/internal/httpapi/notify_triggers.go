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
		// A share came from a person, so it wears their face rather than ours.
		Icon: sender.AvatarPath,
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
		if g.Count <= 0 {
			continue
		}
		done := countTowardGoal(workouts, g, now)
		if done < g.Count {
			continue
		}
		s.notify.Notify(ctx, notify.Event{
			UserID:    userID,
			Kind:      notify.KindGoalMet,
			Title:     "Goal complete: " + describeGoal(g),
			Body:      fmt.Sprintf("%d of %d done this %s", done, g.Count, g.Period),
			Link:      "/",
			DedupeKey: fmt.Sprintf("goal-met:%s:%s", g.ID, periodKey(g.Period, now)),
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
		if g.Count <= 0 || !nearPeriodEnd(g.Period, now) {
			continue
		}
		done := countTowardGoal(workouts, g, now)
		if done >= g.Count {
			continue
		}
		short := g.Count - done
		s.notify.Notify(ctx, notify.Event{
			UserID: userID,
			Kind:   notify.KindGoalAtRisk,
			Title:  fmt.Sprintf("%d to go: %s", short, describeGoal(g)),
			Body:   fmt.Sprintf("This %s is nearly over and you are at %d of %d.", g.Period, done, g.Count),
			Link:   "/",
			// One warning per goal per period.
			DedupeKey: fmt.Sprintf("goal-risk:%s:%s", g.ID, periodKey(g.Period, now)),
		})
	}
}

// countTowardGoal counts the qualifying activities in the goal's current period.
//
// The distance test compares the *displayed* distance, rounded to one decimal
// place, rather than raw metres — a GPS run shown everywhere in the app as
// "5.0 km" is typically stored as about 4,983 m, and a goal that rejected it
// while the UI called it 5 km would simply look broken. This mirrors the same
// rule in the frontend's insights module.
func countTowardGoal(workouts []workout.Workout, g settings.Goal, now time.Time) int {
	start := periodStart(g.Period, now)
	n := 0
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
		n++
	}
	return n
}

// periodStart is the Monday of this week, or the first of this month.
func periodStart(period string, now time.Time) time.Time {
	y, m, d := now.Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, now.Location())
	if period == "month" {
		return time.Date(y, m, 1, 0, 0, 0, 0, now.Location())
	}
	// Go's Sunday-first weekday needs shifting to a Monday-anchored week.
	offset := (int(today.Weekday()) + 6) % 7
	return today.AddDate(0, 0, -offset)
}

// periodKey identifies the current period, so a dedupe key resets when it rolls.
func periodKey(period string, now time.Time) string {
	return periodStart(period, now).Format("2006-01-02")
}

// nearPeriodEnd reports whether there is little enough of the period left that
// a warning is actionable rather than premature: the last two days of a week,
// or the last four of a month.
func nearPeriodEnd(period string, now time.Time) bool {
	start := periodStart(period, now)
	if period == "month" {
		end := start.AddDate(0, 1, 0)
		return end.Sub(now) <= 4*24*time.Hour
	}
	return now.Sub(start) >= 5*24*time.Hour
}

// describeGoal renders a goal the way Settings shows it, e.g. "2 5 km runs a week".
func describeGoal(g settings.Goal) string {
	unit := "week"
	if g.Period == "month" {
		unit = "month"
	}
	what := "activities"
	if g.Type != "" {
		what = g.Type + "s"
	}
	if g.MinKm > 0 {
		what = fmt.Sprintf("%gkm+ %s", g.MinKm, what)
	}
	return fmt.Sprintf("%d %s a %s", g.Count, what, unit)
}
