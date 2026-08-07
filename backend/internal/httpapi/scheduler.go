package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/weather"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// dailySweepInterval is how often the time-driven notification checks run.
// Hourly rather than daily: the process is restarted often enough on a
// self-hosted box that a once-a-day timer would frequently never fire, and the
// dedupe key means the extra runs cost a query and produce nothing.
const dailySweepInterval = time.Hour

// Weather lookups run on their own, much shorter, cadence.
//
// A workout imported a minute ago showing no conditions for the next hour reads
// as broken, and the pass costs one cheap query when there is nothing to do —
// which on an instance where nobody has opted in is always.
const (
	weatherInterval = 5 * time.Minute

	// weatherBatch bounds one pass. At 25 lookups every five minutes the ceiling
	// is 300 an hour, comfortably inside Open-Meteo's free allowance, and a
	// two-thousand-workout backfill drains in about seven hours.
	weatherBatch = 25

	// weatherGap spreads a pass over a few seconds rather than firing 25
	// requests at once. Politeness to a free service nobody is paying for.
	weatherGap = 200 * time.Millisecond

	// weatherMaxAttempts is where a row stops costing anything. Past this it
	// stays 'failed', which the UI reads as "we tried", distinct from "we have
	// not looked".
	//
	// Only genuine failures count towards it. Being throttled does not: that is
	// a fact about the queue, not about the workout, and spending a workout's
	// budget on it would permanently fail perfectly ordinary runs for having
	// been imported on a busy day.
	weatherMaxAttempts = 5

	// weatherThrottleCooldown is how long to leave the service alone after it
	// says we have asked for too much.
	//
	// One hour covers both shapes of limit without needing to tell them apart.
	// A per-minute limit clears long before it elapses; a spent daily allowance
	// clears at midnight, and probing hourly until then costs a couple of dozen
	// requests a day — far less than the five-minute pass would, and far less
	// than the cost of guessing the reset time wrong.
	weatherThrottleCooldown = time.Hour

	// weatherWakeDelay is how long a nudge waits before the pass runs.
	//
	// The delay is the point, not a cost: a bulk import nudges once per file,
	// and waiting a few seconds collapses that burst into one pass instead of
	// starting one and immediately being asked for another. Short enough that a
	// single import still fills in while the user is looking at it.
	weatherWakeDelay = 5 * time.Second

	// weatherMinGap is the closest together two nudged passes may run.
	//
	// Without it a steady trickle of imports would turn the nudge into a much
	// faster ticker, and the batch size stops being a budget: 25 lookups every
	// five seconds is 18,000 an hour against a service whose free allowance is
	// 5,000. The ticker remains the floor, so this only ever delays a pass that
	// was already about to happen soon.
	weatherMinGap = time.Minute

	// trackBatch is how many legacy workouts get a simplified route per pass.
	//
	// Far larger than the weather batch, and it can be: this is local work with
	// no service to be polite to. It is still bounded, because each row means
	// decompressing a full route, and doing a whole library at once on a
	// self-hosted box competes with the requests people are waiting on.
	trackBatch = 200
)

// StartScheduler runs the work that is driven by the clock rather than by a
// user action: the "a goal period is nearly over and you are short" check,
// pruning push subscriptions nothing is behind any more, and filling in the
// weather for workouts that are owed a lookup. It returns when ctx is cancelled.
//
// This is an in-process ticker rather than a cron entry or a job queue because
// the work is a handful of queries for a handful of users; anything more would
// be infrastructure this deployment does not need. Two tickers, one goroutine —
// the weather pass wants a much shorter interval than the daily checks, and
// nothing about it justifies a second thread.
func (s *Server) StartScheduler(ctx context.Context) {
	ticker := time.NewTicker(dailySweepInterval)
	defer ticker.Stop()
	// Not named `weather`: that is the package this file already imports.
	weatherTicker := time.NewTicker(weatherInterval)
	defer weatherTicker.Stop()

	// One pass at startup, so a restart does not skip that day's window.
	s.sweep(ctx)
	s.runWeatherPass(ctx)
	s.trackPass(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweep(ctx)
		case <-weatherTicker.C:
			s.runWeatherPass(ctx)
			// Shares the weather tick rather than adding a third: it is local
			// work that drains and then costs one indexed query that matches
			// nothing, which is the same bargain the notification sweep makes.
			s.trackPass(ctx)
		case <-s.weatherWake:
			// Something was just imported. Without this the workout waits for the
			// next tick — up to five minutes of a page saying "scheduled" for a
			// lookup that takes half a second.
			if s.waitForWeatherWindow(ctx) {
				s.runWeatherPass(ctx)
			}
		}
	}
}

// NudgeWeather asks the scheduler to run a weather pass shortly.
//
// Safe to call from any goroutine and from a request handler: the send is
// non-blocking onto a one-slot channel, so a nudge either lands or finds one
// already waiting, and either way the caller is not delayed and cannot block.
// A nil channel means no scheduler is running — the zero Server in tests — and
// the nudge is simply dropped.
func (s *Server) NudgeWeather() {
	select {
	case s.weatherWake <- struct{}{}:
	default:
	}
}

// nudgeDelay is how long a nudge arriving now should wait before its pass runs.
//
// Pure, and separate from the sleeping, so the pacing can be tested at every
// interesting point without a test that actually waits a minute — which would
// be slow enough to be skipped and timing-dependent enough to be flaky.
func nudgeDelay(lastPass, now time.Time) time.Duration {
	// A server that has never run a pass has a zero lastPass, which is decades
	// ago and correctly reads as "no reason to wait beyond the debounce".
	if since := now.Sub(lastPass); since < weatherMinGap {
		return max(weatherWakeDelay, weatherMinGap-since)
	}
	return weatherWakeDelay
}

// waitForWeatherWindow pauses until a nudged pass may run, reporting whether it
// should still happen. False only when the server is shutting down.
func (s *Server) waitForWeatherWindow(ctx context.Context) bool {
	select {
	case <-ctx.Done():
		return false
	case <-time.After(nudgeDelay(s.lastWeatherPass, time.Now())):
	}
	// Anything that arrived while waiting is covered by the pass about to run.
	// Leaving it queued would cost an immediate second pass that finds nothing —
	// which is exactly the burst this delay exists to collapse.
	select {
	case <-s.weatherWake:
	default:
	}
	return true
}

// runWeatherPass records when a pass happened, so the nudge can pace itself.
// Only the scheduler goroutine touches lastWeatherPass, and there is exactly
// one of it.
func (s *Server) runWeatherPass(ctx context.Context) {
	s.lastWeatherPass = time.Now()
	s.weatherPass(ctx)
}

// weatherPass fills in the conditions for a bounded batch of workouts.
//
// Everything about the weather feature that touches the network happens here
// and nowhere else. Doing it during an import would add up to fifteen seconds
// to an upload and, during a bulk import of five hundred files, serialise five
// hundred round trips into one request — so the import path only ever marks a
// row as owed a lookup, and this collects.
func (s *Server) weatherPass(ctx context.Context) {
	if s.weather == nil {
		return
	}
	// Only the scheduler goroutine reads or writes this, and there is exactly
	// one of it, so a plain field is enough.
	if time.Now().Before(s.weatherCooldownUntil) {
		return
	}
	users, err := s.auth.ListUsers(ctx)
	if err != nil {
		slog.Warn("weather pass: could not list users", "error", err)
		return
	}
	active := make([]int64, 0, len(users))
	for _, u := range users {
		if u.IsActive {
			active = append(active, u.ID)
		}
	}
	enabled, err := s.settings.WeatherEnabledUserIDs(ctx, active)
	if err != nil {
		slog.Warn("weather pass: could not read preferences", "error", err)
		return
	}
	if len(enabled) == 0 {
		return
	}

	// Fully materialised before the first HTTP call, and that is load-bearing
	// rather than tidy: the connection pool holds exactly one connection, so an
	// open cursor plus a network round trip plus an UPDATE is a deadlock that
	// takes the whole process with it. See ListPendingWeather.
	targets, err := s.workout.PendingWeather(ctx, enabled, weatherMaxAttempts, weatherBatch)
	if err != nil {
		slog.Warn("weather pass: could not list pending workouts", "error", err)
		return
	}

	for i, t := range targets {
		if i > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(weatherGap):
			}
		}
		if !s.fetchOneWeather(ctx, t) {
			// The service is unwell. Working through the other twenty-four helps
			// nobody and is exactly the behaviour a rate limit exists to
			// discourage; the next eligible tick picks up where this left off,
			// and the rows are still queued, so the page still says "scheduled".
			return
		}
	}
}

// fetchOneWeather resolves one workout, reporting whether the pass should go on.
func (s *Server) fetchOneWeather(ctx context.Context, t workout.WeatherTarget) (carryOn bool) {
	lat, lon := t.Lat, t.Lon
	if lat == 0 && lon == 0 {
		// A workout from before this feature: its coordinate was never
		// denormalised, so it has to come out of the route blob once.
		resolved, resolvedLon, ok, err := s.workout.ResolveWeatherStart(ctx, t.ID)
		if err != nil {
			slog.Warn("weather: could not read a workout's route", "workout_id", t.ID, "error", err)
			return true
		}
		if !ok {
			// No usable location; ResolveWeatherStart has already settled it.
			return true
		}
		lat, lon = resolved, resolvedLon
	}

	conditions, err := s.weather(ctx, lat, lon, t.StartTime, time.Duration(t.Duration)*time.Second)
	if err != nil {
		if errors.Is(err, weather.ErrThrottled) {
			// Deliberately nothing is written. The row keeps its 'pending'
			// status and its attempt count, so it is picked up again later and
			// the workout page goes on saying "scheduled" rather than reporting
			// a failure that was never about this workout.
			s.weatherCooldownUntil = time.Now().Add(weatherThrottleCooldown)
			slog.Info("weather lookups paused: the service is rate limiting us",
				"retry_after", weatherThrottleCooldown, "error", err)
			return false
		}
		if errors.Is(err, weather.ErrPermanent) {
			slog.Info("weather unavailable for a workout", "workout_id", t.ID, "error", err)
			if err := s.workout.MarkWeatherSkipped(ctx, t.ID); err != nil {
				slog.Warn("weather: could not settle workout", "workout_id", t.ID, "error", err)
			}
			return true
		}
		slog.Warn("weather lookup failed", "workout_id", t.ID, "error", err)
		if err := s.workout.MarkWeatherFailed(ctx, t.ID); err != nil {
			slog.Warn("weather: could not record failure", "workout_id", t.ID, "error", err)
		}
		return false
	}

	if err := s.workout.RecordWeather(ctx, t.ID, workout.Weather{
		TempC:     conditions.TempC,
		ApparentC: conditions.ApparentC,
		Humidity:  conditions.Humidity,
		WindKph:   conditions.WindKph,
		PrecipMm:  conditions.PrecipMm,
		Code:      conditions.Code,
	}); err != nil {
		slog.Warn("weather: could not store reading", "workout_id", t.ID, "error", err)
	}
	return true
}

func (s *Server) sweep(ctx context.Context) {
	users, err := s.auth.ListUsers(ctx)
	if err != nil {
		slog.Warn("notification sweep: could not list users", "error", err)
		return
	}
	for _, u := range users {
		if !u.IsActive {
			continue
		}
		s.checkGoalsAtRisk(ctx, u.ID)
	}

	// Cheap enough to run on the same hourly tick as everything else: one
	// indexed DELETE that matches nothing on all but a handful of passes.
	if n, err := s.notify.PruneSubscriptions(ctx); err != nil {
		slog.Warn("could not prune stale push subscriptions", "error", err)
	} else if n > 0 {
		slog.Info("pruned stale push subscriptions", "count", n)
	}
}

// trackPass gives simplified routes to workouts that predate the overview map.
//
// Everything imported since carries one already, written at insert while the
// route was in memory. This is only for the library that was there first, and
// it empties itself: the partial index it queries shrinks to nothing, after
// which the pass is one query that matches no rows.
func (s *Server) trackPass(ctx context.Context) {
	pending, err := s.workout.MissingTracks(ctx, trackBatch)
	if err != nil {
		slog.Warn("track pass: could not list workouts", "error", err)
		return
	}
	if len(pending) == 0 {
		return
	}
	for _, item := range pending {
		select {
		case <-ctx.Done():
			return
		default:
		}
		// Settles the row either way. A workout with no usable route is stored
		// as looked-at-and-empty rather than left pending, or the pass would
		// pick the same rows up forever and never reach the rest.
		if err := s.workout.StoreTrack(ctx, item.ID, item.Route); err != nil {
			slog.Warn("track pass: could not store track", "workout_id", item.ID, "error", err)
			return
		}
	}
	slog.Info("prepared workouts for the map", "count", len(pending))
}
