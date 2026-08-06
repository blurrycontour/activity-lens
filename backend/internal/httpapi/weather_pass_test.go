package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/store"
	"github.com/blurrycontour/activity-lens/backend/internal/weather"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// Being rate limited says nothing about the workout being looked up. Counting
// it against that workout's retry budget spends five attempts on a queue that
// was never its fault — so a run imported on a busy day ends up permanently
// marked as impossible, having never really been tried, and there is nothing in
// the UI to suggest anything went wrong.

func weatherTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenSQLite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.MigrateApp(context.Background(), db); err != nil {
		t.Fatalf("MigrateApp: %v", err)
	}
	return db
}

// queuedWorkout creates an outdoor workout waiting for a lookup.
func queuedWorkout(t *testing.T, svc *workout.Service) *workout.Workout {
	t.Helper()
	wk, _, err := svc.CreateIdempotent(context.Background(), 1, workout.Input{
		Name:       "morning run",
		Type:       workout.TypeRun,
		StartTime:  time.Date(2024, 5, 4, 7, 0, 0, 0, time.UTC),
		Duration:   1800,
		Distance:   5000,
		Source:     workout.SourceUpload,
		ExternalID: "hash-1",
		Route:      []workout.LatLng{{51.5074, -0.1278}},
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return wk
}

func TestThrottlingLeavesWorkoutsScheduled(t *testing.T) {
	db := weatherTestDB(t)
	repo := workout.NewSQLiteRepository(db)
	svc := workout.NewService(repo)
	wk := queuedWorkout(t, svc)

	s := &Server{workout: svc}
	s.weather = func(context.Context, float64, float64, time.Time, time.Duration) (weather.Conditions, error) {
		return weather.Conditions{}, fmt.Errorf("%w: Daily API request limit exceeded", weather.ErrThrottled)
	}

	targets, err := repo.ListPendingWeather(context.Background(), []int64{1}, 5, 10)
	if err != nil || len(targets) != 1 {
		t.Fatalf("setup: %d pending, err %v", len(targets), err)
	}

	if carryOn := s.fetchOneWeather(context.Background(), targets[0]); carryOn {
		t.Error("the pass carried on through a rate limit; it should stand down")
	}
	if s.weatherCooldownUntil.IsZero() || !s.weatherCooldownUntil.After(time.Now()) {
		t.Error("no cooldown was set, so the next tick would hammer the service again")
	}

	got, err := repo.Get(context.Background(), 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	// The status is what the workout page reads to say "Scheduled".
	if got.WeatherStatus != workout.WeatherPending {
		t.Errorf("status = %q, want pending — a busy service is not this workout's failure", got.WeatherStatus)
	}

	// And the row must still be selectable, however often this happens: the
	// attempt counter is the thing that would otherwise run out.
	for i := 0; i < 10; i++ {
		if carryOn := s.fetchOneWeather(context.Background(), targets[0]); carryOn {
			t.Fatal("expected the pass to stand down every time")
		}
	}
	still, err := repo.ListPendingWeather(context.Background(), []int64{1}, 5, 10)
	if err != nil {
		t.Fatalf("ListPendingWeather: %v", err)
	}
	if len(still) != 1 {
		t.Error("the workout dropped out of the queue after repeated rate limiting")
	}
}

// A cooldown that is never consulted is decoration.
func TestWeatherPassRespectsItsCooldown(t *testing.T) {
	s := &Server{weatherCooldownUntil: time.Now().Add(time.Hour)}
	called := false
	s.weather = func(context.Context, float64, float64, time.Time, time.Duration) (weather.Conditions, error) {
		called = true
		return weather.Conditions{}, nil
	}
	// Returns before touching auth or settings, both of which are nil here —
	// so reaching either would panic and fail this test loudly.
	s.weatherPass(context.Background())
	if called {
		t.Error("the pass ran while cooling down")
	}
}

// The other half: an ordinary failure *must* still count, or a workout the
// service genuinely cannot answer for is retried forever.
func TestOrdinaryFailuresStillCountAgainstTheBudget(t *testing.T) {
	db := weatherTestDB(t)
	repo := workout.NewSQLiteRepository(db)
	svc := workout.NewService(repo)
	wk := queuedWorkout(t, svc)

	s := &Server{workout: svc}
	s.weather = func(context.Context, float64, float64, time.Time, time.Duration) (weather.Conditions, error) {
		return weather.Conditions{}, errors.New("connection reset")
	}

	targets, err := repo.ListPendingWeather(context.Background(), []int64{1}, 5, 10)
	if err != nil || len(targets) != 1 {
		t.Fatalf("setup: %d pending, err %v", len(targets), err)
	}
	for i := 0; i < 5; i++ {
		s.fetchOneWeather(context.Background(), targets[0])
	}
	if !s.weatherCooldownUntil.IsZero() {
		t.Error("an ordinary failure set the throttle cooldown; that is only for rate limits")
	}

	remaining, err := repo.ListPendingWeather(context.Background(), []int64{1}, 5, 10)
	if err != nil {
		t.Fatalf("ListPendingWeather: %v", err)
	}
	if len(remaining) != 0 {
		t.Error("a repeatedly failing workout is still being retried past the cap")
	}
	got, err := repo.Get(context.Background(), 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.WeatherStatus != workout.WeatherFailed {
		t.Errorf("status = %q, want failed so the page can say we tried", got.WeatherStatus)
	}
}

// A permanent rejection settles the row immediately rather than spending five
// attempts discovering the same thing.
func TestPermanentFailureSettlesImmediately(t *testing.T) {
	db := weatherTestDB(t)
	repo := workout.NewSQLiteRepository(db)
	svc := workout.NewService(repo)
	wk := queuedWorkout(t, svc)

	s := &Server{workout: svc}
	s.weather = func(context.Context, float64, float64, time.Time, time.Duration) (weather.Conditions, error) {
		return weather.Conditions{}, fmt.Errorf("%w: no samples cover the workout", weather.ErrPermanent)
	}

	targets, _ := repo.ListPendingWeather(context.Background(), []int64{1}, 5, 10)
	if carryOn := s.fetchOneWeather(context.Background(), targets[0]); !carryOn {
		t.Error("one unanswerable workout should not stop the pass")
	}
	got, err := repo.Get(context.Background(), 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.WeatherStatus != workout.WeatherSkipped {
		t.Errorf("status = %q, want skipped", got.WeatherStatus)
	}
}

// A nudge is sent from a request handler, so the one thing it must never do is
// make the person uploading a file wait — least of all when the scheduler is
// busy inside a fifteen-second lookup and nothing is reading the channel.
func TestNudgeWeatherNeverBlocksAnImport(t *testing.T) {
	s := &Server{weatherWake: make(chan struct{}, 1)}

	done := make(chan struct{})
	go func() {
		defer close(done)
		// Stands in for a bulk import: far more nudges than the channel can hold,
		// with nobody draining it.
		for i := 0; i < 1000; i++ {
			s.NudgeWeather()
		}
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("NudgeWeather blocked; an import would have hung behind it")
	}

	// One slot, and one is all that is wanted: a nudge is a fact, not a count.
	if len(s.weatherWake) != 1 {
		t.Errorf("queued %d wakeups for one burst, want 1", len(s.weatherWake))
	}
}

// Every Server built by hand in a test has a nil channel, and so does any
// deployment running without the scheduler.
func TestNudgeWeatherToleratesNoScheduler(t *testing.T) {
	s := &Server{}
	done := make(chan struct{})
	go func() { defer close(done); s.NudgeWeather() }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("NudgeWeather blocked on a nil channel instead of dropping the nudge")
	}
}

// The pacing is what stops the nudge becoming a much faster ticker. At 25
// lookups a pass, one pass every five seconds would be 18,000 requests an hour
// against a free allowance of 5,000.
func TestNudgedPassesStayInsideTheirBudget(t *testing.T) {
	now := time.Now()

	if got := nudgeDelay(now.Add(-10*time.Minute), now); got != weatherWakeDelay {
		t.Errorf("after a long quiet spell delay = %v, want the plain debounce %v", got, weatherWakeDelay)
	}
	// A server that has never run a pass: the zero time is decades ago and must
	// not be read as "a pass just happened".
	if got := nudgeDelay(time.Time{}, now); got != weatherWakeDelay {
		t.Errorf("at startup delay = %v, want %v", got, weatherWakeDelay)
	}
	// Just ran: wait out the rest of the gap rather than going again.
	if got := nudgeDelay(now.Add(-time.Second), now); got < weatherMinGap-2*time.Second {
		t.Errorf("straight after a pass delay = %v, want close to %v", got, weatherMinGap)
	}
	// Never shorter than the debounce, however recent the last pass — that is
	// what collapses a bulk import into one wakeup.
	for _, since := range []time.Duration{0, time.Second, 30 * time.Second, weatherMinGap, time.Hour} {
		if got := nudgeDelay(now.Add(-since), now); got < weatherWakeDelay {
			t.Errorf("nudgeDelay(%v ago) = %v, shorter than the debounce %v", since, got, weatherWakeDelay)
		}
	}
}

// Shutdown must not be held up by a pending nudge.
func TestWaitForWeatherWindowGivesUpOnShutdown(t *testing.T) {
	s := &Server{weatherWake: make(chan struct{}, 1)}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if s.waitForWeatherWindow(ctx) {
		t.Error("a cancelled context still asked for a pass")
	}
}
