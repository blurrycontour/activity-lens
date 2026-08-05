package workout

import (
	"context"
	"testing"
	"time"
)

// Weather is stored across seven columns read back by two independent
// positional scanners. Nothing about a wrong reading looks wrong — it is a
// plausible number on a plausible workout — so the round trip and the state
// machine both get held down here.

func outdoorInput(name string) Input {
	in := importInput(name, "hash-"+name)
	in.ContentHash = "hash-" + name
	// A real place, so nothing here is confused with the Null Island guard.
	in.Route = []LatLng{{51.5074, -0.1278}, {51.5080, -0.1290}}
	return in
}

var sampleWeather = Weather{
	TempC: 12.5, ApparentC: 10.1, Humidity: 68, WindKph: 14.4, PrecipMm: 0.4, Code: 61,
}

// deriveWeatherTarget decides, once and permanently, whether a workout will
// ever be looked up. Getting "skipped" wrong in one direction retries every
// strength session forever; in the other it silently gives up on real runs.
func TestDeriveWeatherTarget(t *testing.T) {
	route := []LatLng{{51.5074, -0.1278}}
	tests := []struct {
		name       string
		workout    Workout
		wantStatus WeatherStatus
	}{
		{"an outdoor run with a route is queued",
			Workout{Type: TypeRun, Route: route}, WeatherPending},
		{"no route means no location, ever",
			Workout{Type: TypeRun}, WeatherSkipped},
		{"strength is indoors by definition",
			Workout{Type: TypeStrength, Route: route}, WeatherSkipped},
		{"Null Island is what a GPS writes with no fix",
			Workout{Type: TypeRun, Route: []LatLng{{0, 0}}}, WeatherSkipped},
		{"an impossible latitude is a corrupt file",
			Workout{Type: TypeRun, Route: []LatLng{{91, 0}}}, WeatherSkipped},
		{"an impossible longitude too",
			Workout{Type: TypeRun, Route: []LatLng{{51.5, 181}}}, WeatherSkipped},
		{"no archive has next week's weather",
			Workout{Type: TypeRun, Route: route, StartTime: time.Now().Add(72 * time.Hour)}, WeatherSkipped},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			lat, lon, got := deriveWeatherTarget(&tt.workout)
			if got != tt.wantStatus {
				t.Errorf("status = %q, want %q", got, tt.wantStatus)
			}
			if tt.wantStatus == WeatherPending && (lat == 0 || lon == 0) {
				t.Errorf("queued a lookup with no coordinate: %v, %v", lat, lon)
			}
		})
	}
}

// Both scanners take positional arguments against one column list. If either
// drifts, every field after the mistake shifts — and the values still look like
// values, so nothing fails.
func TestWeatherSurvivesBothScanners(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("morning run"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := repo.SetWeather(ctx, wk.ID, WeatherOK, sampleWeather); err != nil {
		t.Fatalf("SetWeather: %v", err)
	}

	got, err := repo.Get(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Weather == nil {
		t.Fatal("detail read lost the weather entirely")
	}
	if *got.Weather != sampleWeather {
		t.Errorf("detail weather = %+v, want %+v", *got.Weather, sampleWeather)
	}
	if got.WeatherStatus != WeatherOK {
		t.Errorf("detail status = %q, want ok", got.WeatherStatus)
	}

	// The summary set carries weather so the Analysis page can correlate from
	// the list it already loads. If it silently stopped, the chart would just
	// look empty.
	list, err := repo.ListSummary(ctx, 1)
	if err != nil {
		t.Fatalf("ListSummary: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("got %d workouts, want 1", len(list))
	}
	if list[0].Weather == nil {
		t.Fatal("summary read lost the weather; the correlation view would be empty")
	}
	if *list[0].Weather != sampleWeather {
		t.Errorf("summary weather = %+v, want %+v", *list[0].Weather, sampleWeather)
	}
}

// Every weather column is NOT NULL DEFAULT 0, so a workout nobody has looked up
// scans as a perfectly believable 0 °C on a clear, still day. The status is the
// only thing standing between that and the user's screen.
func TestUnfetchedWeatherIsAbsentNotZero(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("not looked up yet"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := repo.Get(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Weather != nil {
		t.Errorf("Weather = %+v, want nil — a default is not a reading", *got.Weather)
	}
	if got.WeatherStatus != WeatherPending {
		t.Errorf("status = %q, want pending", got.WeatherStatus)
	}
}

// Update's SET list deliberately never mentions a weather column, so editing a
// workout or recalculating its metrics cannot wipe a reading. That is an
// omission, and an omission is exactly the kind of thing a later edit restores
// without noticing.
func TestUpdateDoesNotClobberWeather(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("evening run"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := repo.SetWeather(ctx, wk.ID, WeatherOK, sampleWeather); err != nil {
		t.Fatalf("SetWeather: %v", err)
	}

	loaded, err := repo.Get(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	loaded.Name = "renamed"
	loaded.Weather = nil // as a caller that knows nothing about weather would
	if err := repo.Update(ctx, loaded); err != nil {
		t.Fatalf("Update: %v", err)
	}

	after, err := repo.Get(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("Get after update: %v", err)
	}
	if after.Name != "renamed" {
		t.Errorf("name = %q, want the update to have applied", after.Name)
	}
	if after.Weather == nil || *after.Weather != sampleWeather {
		t.Error("Update wiped the weather; it must not touch those columns")
	}
}

// A person who typed a temperature in outranks the grid. If a later pass could
// overwrite it, the correction would silently revert.
func TestManualWeatherIsNotSelectedForLookup(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("hand corrected"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.SetManualWeather(ctx, 1, wk.ID, sampleWeather); err != nil {
		t.Fatalf("SetManualWeather: %v", err)
	}

	pending, err := repo.ListPendingWeather(ctx, []int64{1}, 5, 10)
	if err != nil {
		t.Fatalf("ListPendingWeather: %v", err)
	}
	if len(pending) != 0 {
		t.Errorf("a manual reading was queued for overwrite: %+v", pending)
	}
	// And a failure recorded against it must not demote it either.
	if err := repo.MarkWeatherFailed(ctx, wk.ID); err != nil {
		t.Fatalf("MarkWeatherFailed: %v", err)
	}
	got, err := repo.Get(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.WeatherStatus != WeatherManual {
		t.Errorf("status = %q, want manual to survive a failed lookup", got.WeatherStatus)
	}
}

// A typo of 250 instead of 25 does not look wrong on the workout it is entered
// on — it quietly bends a whole temperature bucket in the analysis.
func TestManualWeatherRejectsImpossibleValues(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("validated"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	bad := []struct {
		name string
		w    Weather
	}{
		{"a temperature off the scale", Weather{TempC: 250}},
		{"humidity above 100%", Weather{TempC: 20, Humidity: 140}},
		{"negative wind", Weather{TempC: 20, WindKph: -5}},
		{"a code outside WMO's range", Weather{TempC: 20, Code: 400}},
	}
	for _, tt := range bad {
		t.Run(tt.name, func(t *testing.T) {
			if err := svc.SetManualWeather(ctx, 1, wk.ID, tt.w); err == nil {
				t.Error("expected the value to be rejected")
			}
		})
	}
}

// Someone else's workout must not be writable, and the error must not reveal
// that it exists.
func TestManualWeatherIsOwnerScoped(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("mine"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.SetManualWeather(ctx, 2, wk.ID, sampleWeather); err == nil {
		t.Fatal("another user was allowed to write weather")
	}
	got, err := repo.Get(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Weather != nil {
		t.Error("the write landed anyway")
	}
}

// The queue is what the background pass reads. Returning the wrong rows means
// either burning the request budget on workouts that can never answer, or
// never getting to the ones that can.
func TestListPendingWeatherSelection(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	queued, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("queued"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	done, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("already done"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := repo.SetWeather(ctx, done.ID, WeatherOK, sampleWeather); err != nil {
		t.Fatalf("SetWeather: %v", err)
	}
	indoor, _, err := svc.CreateIdempotent(ctx, 1, importInput("indoor", "hash-indoor"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Another user's workout must never appear in this user's batch.
	if _, _, err := svc.CreateIdempotent(ctx, 2, outdoorInput("someone else")); err != nil {
		t.Fatalf("create: %v", err)
	}

	got, err := repo.ListPendingWeather(ctx, []int64{1}, 5, 10)
	if err != nil {
		t.Fatalf("ListPendingWeather: %v", err)
	}
	if len(got) != 1 || got[0].ID != queued.ID {
		var ids []string
		for _, t := range got {
			ids = append(ids, t.ID)
		}
		t.Fatalf("pending = %v, want only %s (done=%s indoor=%s)", ids, queued.ID, done.ID, indoor.ID)
	}
	if got[0].Lat == 0 || got[0].Lon == 0 {
		t.Error("the target carries no coordinate, so the lookup cannot run")
	}
	if got[0].StartTime.IsZero() || got[0].Duration == 0 {
		t.Error("the target carries no time window")
	}
}

// Past the cap a row stops costing anything, and rests as 'failed' — which the
// UI reads as "we tried", distinct from "we have not looked".
func TestListPendingWeatherHonoursTheAttemptCap(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("keeps failing"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	for i := 0; i < 3; i++ {
		if err := repo.MarkWeatherFailed(ctx, wk.ID); err != nil {
			t.Fatalf("MarkWeatherFailed: %v", err)
		}
	}
	if got, err := repo.ListPendingWeather(ctx, []int64{1}, 5, 10); err != nil || len(got) != 1 {
		t.Fatalf("under the cap: got %d rows, err %v — should still retry", len(got), err)
	}
	if got, err := repo.ListPendingWeather(ctx, []int64{1}, 3, 10); err != nil || len(got) != 0 {
		t.Fatalf("at the cap: got %d rows, err %v — should have stopped", len(got), err)
	}
}

// The backfill is the only thing that moves a whole library out of 'none', and
// it only ever runs when someone asks. Everything imported before this feature
// must stay untouched until then.
func TestBackfillIsOptIn(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("recent"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	// Stand in for a workout that predates the feature: the migration defaults
	// every existing row to 'none' with no coordinate, because the coordinate
	// lives inside a compressed blob that SQL cannot read.
	if _, err := repo.db.ExecContext(ctx,
		`UPDATE workouts SET weather_status = 'none', start_lat = 0, start_lon = 0 WHERE id = ?`,
		wk.ID); err != nil {
		t.Fatalf("simulate legacy row: %v", err)
	}

	if got, err := repo.ListPendingWeather(ctx, []int64{1}, 5, 10); err != nil || len(got) != 0 {
		t.Fatalf("a legacy workout was queued without being asked for: %d rows, err %v", len(got), err)
	}
	counts, err := repo.WeatherCounts(ctx, 1)
	if err != nil || counts.Unchecked != 1 {
		t.Fatalf("unchecked = %d, err %v, want 1", counts.Unchecked, err)
	}

	queued, err := repo.RequestWeatherBackfill(ctx, 1)
	if err != nil || queued != 1 {
		t.Fatalf("RequestWeatherBackfill = %d, err %v, want 1", queued, err)
	}
	got, err := repo.ListPendingWeather(ctx, []int64{1}, 5, 10)
	if err != nil || len(got) != 1 {
		t.Fatalf("after the backfill was requested: %d rows, err %v, want 1", len(got), err)
	}
	// It has no stored coordinate, so the pass has to recover one from the route.
	if got[0].Lat != 0 || got[0].Lon != 0 {
		t.Errorf("expected a legacy row to have no coordinate yet, got %v,%v", got[0].Lat, got[0].Lon)
	}
	lat, lon, ok, err := repo.ResolveWeatherStart(ctx, wk.ID)
	if err != nil || !ok {
		t.Fatalf("ResolveWeatherStart: ok=%v err=%v", ok, err)
	}
	if lat == 0 || lon == 0 {
		t.Errorf("resolved coordinate is empty: %v, %v", lat, lon)
	}
}

// A legacy workout with no route can never answer, and must be settled rather
// than decompressed again on every pass.
func TestResolveWeatherStartSettlesRoutelessWorkouts(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, importInput("no route", "hash-noroute"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	_, _, ok, err := repo.ResolveWeatherStart(ctx, wk.ID)
	if err != nil {
		t.Fatalf("ResolveWeatherStart: %v", err)
	}
	if ok {
		t.Fatal("a workout with no route reported a usable location")
	}
	got, err := repo.Get(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.WeatherStatus != WeatherSkipped {
		t.Errorf("status = %q, want skipped so it is never read again", got.WeatherStatus)
	}
}

// The attempt cap is what stops an unanswerable workout being retried forever,
// but a transient outage exhausts it just as surely — and until this existed
// there was no way back except typing the conditions in by hand.
func TestRetryFailedWeatherReopensExhaustedLookups(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("failed during an outage"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	for i := 0; i < 5; i++ {
		if err := repo.MarkWeatherFailed(ctx, wk.ID); err != nil {
			t.Fatalf("MarkWeatherFailed: %v", err)
		}
	}
	if got, _ := repo.ListPendingWeather(ctx, []int64{1}, 5, 10); len(got) != 0 {
		t.Fatalf("setup: expected the workout to be out of the queue, got %d", len(got))
	}

	n, err := repo.RetryFailedWeather(ctx, 1)
	if err != nil || n != 1 {
		t.Fatalf("RetryFailedWeather = %d, err %v, want 1", n, err)
	}
	// Clearing the counter rather than raising the cap is the point: the retry
	// gets the same bounded budget, so a service that is genuinely down cannot
	// be hammered indefinitely by one click.
	got, err := repo.ListPendingWeather(ctx, []int64{1}, 5, 10)
	if err != nil || len(got) != 1 {
		t.Fatalf("after the retry: %d rows, err %v, want 1", len(got), err)
	}
}

// Retrying must not disturb anything that is not a failure — least of all a
// manual entry, which would be re-fetched and overwritten.
func TestRetryFailedWeatherTouchesOnlyFailures(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	typed, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("typed in by hand"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if err := svc.SetManualWeather(ctx, 1, typed.ID, Weather{TempC: 21, ApparentC: 21, Humidity: 50, WindKph: 5}); err != nil {
		t.Fatalf("SetManualWeather: %v", err)
	}
	legacy, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput("predates the feature"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if _, err := repo.db.ExecContext(ctx,
		`UPDATE workouts SET weather_status = 'none' WHERE id = ?`, legacy.ID); err != nil {
		t.Fatalf("simulate legacy row: %v", err)
	}

	if n, err := repo.RetryFailedWeather(ctx, 1); err != nil || n != 0 {
		t.Fatalf("RetryFailedWeather = %d, err %v, want 0 — nothing here has failed", n, err)
	}

	got, err := repo.Get(ctx, 1, typed.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.WeatherStatus != WeatherManual {
		t.Errorf("a hand-entered reading was re-queued: status = %q", got.WeatherStatus)
	}
	// A legacy row must stay opt-in: the retry button is about failures, not a
	// second route into sending an untouched library to a third party.
	after, err := repo.Get(ctx, 1, legacy.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if after.WeatherStatus != WeatherNone {
		t.Errorf("retrying swept in a never-checked workout: status = %q", after.WeatherStatus)
	}
}

// The settings page shows every number at once, so they have to agree with each
// other and with what the queue will actually do.
func TestWeatherCountsTalliesEachState(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	mk := func(name string) *Workout {
		wk, _, err := svc.CreateIdempotent(ctx, 1, outdoorInput(name))
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		return wk
	}
	fetched := mk("fetched")
	if err := repo.SetWeather(ctx, fetched.ID, WeatherOK, Weather{TempC: 12}); err != nil {
		t.Fatalf("SetWeather: %v", err)
	}
	typed := mk("typed")
	if err := svc.SetManualWeather(ctx, 1, typed.ID, Weather{TempC: 21, ApparentC: 21}); err != nil {
		t.Fatalf("SetManualWeather: %v", err)
	}
	mk("still queued")
	broken := mk("broken")
	if err := repo.MarkWeatherFailed(ctx, broken.ID); err != nil {
		t.Fatalf("MarkWeatherFailed: %v", err)
	}
	indoor := mk("indoor")
	if err := repo.MarkWeatherSkipped(ctx, indoor.ID); err != nil {
		t.Fatalf("MarkWeatherSkipped: %v", err)
	}

	got, err := repo.WeatherCounts(ctx, 1)
	if err != nil {
		t.Fatalf("WeatherCounts: %v", err)
	}
	// Recorded folds fetched and hand-entered together: from the outside a
	// workout either has conditions on it or does not.
	want := WeatherCounts{Recorded: 2, Manual: 1, Scheduled: 1, Failed: 1, Skipped: 1}
	if got != want {
		t.Errorf("counts = %+v, want %+v", got, want)
	}

	// Another user's library must not appear in these numbers.
	if other, err := repo.WeatherCounts(ctx, 2); err != nil || other != (WeatherCounts{}) {
		t.Errorf("counts for a user with no workouts = %+v, err %v", other, err)
	}
}
