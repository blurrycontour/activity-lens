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
	"github.com/blurrycontour/activity-lens/backend/internal/plans"
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

// notifyPlanShared tells the recipient that someone shared a training plan.
func (s *Server) notifyPlanShared(r *http.Request, sender auth.User, targetID int64, p *plans.Plan) {
	from := sender.DisplayName
	if from == "" {
		from = sender.Username
	}
	days := len(p.Days)
	s.notify.Notify(r.Context(), notify.Event{
		UserID: targetID,
		Kind:   notify.KindPlanShared,
		Title:  fmt.Sprintf("%s shared a plan with you", from),
		Body:   fmt.Sprintf("%s · %d day%s", p.Name, days, plural(days)),
		Link:   "/discover/plan/" + p.ID,
		Icon:   effectiveAvatar(sender),
	})
}

// notifySessionShared tells the recipient that someone shared a finished session.
func (s *Server) notifySessionShared(r *http.Request, sender auth.User, targetID int64, sess *plans.Session) {
	from := sender.DisplayName
	if from == "" {
		from = sender.Username
	}
	s.notify.Notify(r.Context(), notify.Event{
		UserID: targetID,
		Kind:   notify.KindSessionShared,
		Title:  fmt.Sprintf("%s shared a session with you", from),
		Body:   fmt.Sprintf("%s · %d/%d sets", sess.DayName, sess.DoneSets, sess.TotalSets),
		Link:   "/discover/session/" + sess.ID,
		Icon:   effectiveAvatar(sender),
	})
}

func plural(n int) string {
	if n == 1 {
		return ""
	}
	return "s"
}

// notifySocial tells the people following a workout that someone said
// something on it.
//
// Who "following" means: the owner, plus anyone else who has already commented.
// A conversation nobody is told about is a conversation that happens once, and
// on an instance with a handful of people the alternative — a subscribe button
// — would be more machinery than the feature is.
//
// The actor never hears about their own action, and each recipient is told once
// however many ways they qualify.
func (s *Server) notifySocial(r *http.Request, actor auth.User, subj workout.Subject, ownerID int64, link, title, body, dedupe string) {
	recipients := map[int64]bool{ownerID: true}
	// Best effort: the comment or reaction has already been stored, and failing
	// to read the thread is not a reason to fail the request that made it.
	if comments, err := s.workout.Comments(r.Context(), subj); err == nil {
		for _, c := range comments {
			recipients[c.UserID] = true
		}
	} else {
		slog.Warn("could not load thread for social notification", "subject", subj.ID, "error", err)
	}
	delete(recipients, actor.ID)

	for id := range recipients {
		s.notify.Notify(r.Context(), notify.Event{
			UserID: id,
			Kind:   notify.KindWorkoutSocial,
			Title:  title,
			Body:   body,
			// Straight to the tab it happened in: landing on the charts and
			// leaving someone to find the conversation would waste the tap.
			Link: link,
			// It came from a person, so it wears their face.
			Icon:      effectiveAvatar(actor),
			DedupeKey: dedupe,
		})
	}
}

// actorName is how a person is named in a notification about what they did.
func actorName(u auth.User) string {
	if u.DisplayName != "" {
		return u.DisplayName
	}
	return u.Username
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

/*
afterWorkoutRemoved re-reads the same conditions after a workout goes away.

Deleting is as capable of changing whether a goal is met or a shoe is worn out
as adding, and until now nothing looked. The state would then say a goal was
met while it was not, and the next time it was genuinely earned -- the same
file re-imported, or a real ride -- nothing would be said, because as far as
anything knew it had never stopped being true.

No notification comes out of this in practice: every check here fires on a
condition becoming true, and removing a workout can only make one false.
*/
func (s *Server) afterWorkoutRemoved(r *http.Request, userID int64) {
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

/*
checkGoals notifies when a goal is *newly* met for the current period.

Newly is the whole point, and it used to be missing. The check ran on every
recorded workout, asked "is this goal over its target", and notified if the
dedupe key had not been used this period -- so a goal completed before anyone
was watching (history imported first, the goal written afterwards, the switch
turned on later) was announced by whatever workout happened to run the check
next. One ride, three notifications, none of them about the ride.

So the answer comes from notify.Crossed, which knows what the goal looked like
last time and treats a first sighting as a baseline rather than as news. That
also means the marker is no longer the notification itself: emptying the
notification list does not re-arm anything, and a goal that drops back under
target -- a workout deleted -- and is genuinely earned again says so.
*/
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
		// The key carries the period, so each week or month is a condition of
		// its own and starts out false -- which is what makes the first
		// completion of a new period news again.
		key := fmt.Sprintf("goal-met:%s:%s", g.ID, g.PeriodKey(now))
		if !s.notify.Crossed(ctx, userID, key, done >= g.Target) {
			continue
		}
		s.notify.Notify(ctx, notify.Event{
			UserID: userID,
			Kind:   notify.KindGoalMet,
			Title:  "Goal complete: " + g.Describe(),
			Body:   fmt.Sprintf("%s of %s done this %s", g.FormatAmount(done), g.FormatAmount(g.Target), g.Period),
			Link:   "/",
			// No dedupe key: Crossed already answers "once, when it happens",
			// and a key here would additionally suppress the second time a
			// goal is genuinely earned inside one period.
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

// Bounds on the "you have no goals" nudge. See checkNoGoals.
const (
	// noGoalsMinWorkouts is how much history someone needs before the nudge
	// makes sense. Suggesting a weekly target to an account with two imports is
	// advice about a training habit that has not been established yet.
	noGoalsMinWorkouts = 5

	// noGoalsActiveDays is how recently they must have trained. This is what
	// stops the nudge running forever: it is the only kind that fires on
	// nothing happening, so it needs something to switch it off, and someone
	// who is not training does not want to be told to set a target.
	noGoalsActiveDays = 14

	// noGoalsMinPeriod and noGoalsPeriodSpread set the cadence: every two or
	// three days, which of the two being fixed per user. A single interval
	// would land every instance's users on the same day; the jitter is per
	// account and constant, so the rhythm is steady rather than surprising.
	noGoalsMinPeriod    = 2
	noGoalsPeriodSpread = 2
)

// checkNoGoals nudges someone who trains regularly and has set no goals.
//
// The only notification in the app that reports on nothing having happened,
// which makes it the only one that can become nagging — so it is bounded three
// ways: enough history to have a habit worth measuring, recent enough activity
// that they are still training, and a dedupe key that admits one message every
// two or three days. Beyond that it is a kind like any other and the Settings
// switch turns it off.
//
// No new state. The cadence comes out of the dedupe key: the day number is
// divided into buckets, and every run inside one bucket produces the same key,
// which Notify already discards.
func (s *Server) checkNoGoals(ctx context.Context, userID int64) {
	prefs, err := s.settings.UserPreferences(ctx, userID)
	if err != nil || len(prefs.Goals) > 0 {
		return
	}
	workouts, err := s.workout.ListSummary(ctx, userID)
	if err != nil || len(workouts) < noGoalsMinWorkouts {
		return
	}

	now := time.Now()
	cutoff := now.AddDate(0, 0, -noGoalsActiveDays)
	recent := false
	for _, w := range workouts {
		if w.StartTime.After(cutoff) {
			recent = true
			break
		}
	}
	if !recent {
		return
	}

	// Days since the epoch, bucketed. The offset staggers accounts so a shared
	// instance does not remind everyone on the same morning.
	day := now.Unix() / 86400
	period := noGoalsMinPeriod + userID%noGoalsPeriodSpread
	bucket := (day + userID) / period

	s.notify.Notify(ctx, notify.Event{
		UserID: userID,
		Kind:   notify.KindGoalNoneSet,
		Title:  "Set a training goal",
		Body:   "You have been training steadily. A weekly or monthly target gives the dashboard something to measure it against.",
		Link:   "/settings/goals",
		// One per bucket, so the cadence is the bucket width.
		DedupeKey: fmt.Sprintf("goal-none:%d", bucket),
	})
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
