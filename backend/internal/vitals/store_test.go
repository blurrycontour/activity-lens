package vitals

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/store"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.MigrateApp(context.Background(), db); err != nil {
		t.Fatalf("MigrateApp() error = %v", err)
	}
	return db
}

func f64(v float64) *float64 { return &v }
func i(v int) *int           { return &v }

// A measurement with no reading at all is meaningless and must be rejected — it
// is the one thing the single shared endpoint cannot let through.
func TestCreateRejectsEmptyMeasurement(t *testing.T) {
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	if _, err := svc.Create(context.Background(), 1, Input{Note: "nothing"}); err == nil {
		t.Fatal("expected an error for a measurement with no weight or blood pressure")
	}
}

// Blood pressure with systolic at or below diastolic is a data-entry slip, not
// a reading; catching it keeps a nonsensical row out of the chart.
func TestCreateRejectsInvertedBloodPressure(t *testing.T) {
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	if _, err := svc.Create(context.Background(), 1, Input{Systolic: i(80), Diastolic: i(120)}); err == nil {
		t.Fatal("expected an error when systolic <= diastolic")
	}
}

// LatestWeight underpins the unified profile weight, so it must return the most
// recent weigh-in and ignore blood-pressure-only rows.
func TestLatestWeightIgnoresBloodPressureRows(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	const user int64 = 1

	old := time.Now().UTC().Add(-48 * time.Hour)
	recent := time.Now().UTC().Add(-1 * time.Hour)
	if _, err := svc.Create(ctx, user, Input{MeasuredAt: old, WeightKg: f64(80)}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, user, Input{MeasuredAt: recent, WeightKg: f64(78.5)}); err != nil {
		t.Fatal(err)
	}
	// A later blood-pressure reading with no weight must not become "latest".
	if _, err := svc.Create(ctx, user, Input{MeasuredAt: time.Now().UTC(), Systolic: i(120), Diastolic: i(80), Pulse: i(60)}); err != nil {
		t.Fatal(err)
	}

	latest, err := svc.LatestWeight(ctx, user)
	if err != nil {
		t.Fatalf("LatestWeight() error = %v", err)
	}
	if latest == nil || *latest != 78.5 {
		t.Fatalf("LatestWeight() = %v, want 78.5", latest)
	}
}

// Deleting an account must take its vitals with it: the rows are keyed by a user
// id nothing else cascades from.
func TestPurgeUserRemovesOnlyThatUsersVitals(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	const alice, bob int64 = 1, 2
	if _, err := svc.Create(ctx, alice, Input{WeightKg: f64(70)}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, bob, Input{WeightKg: f64(90)}); err != nil {
		t.Fatal(err)
	}
	if err := svc.PurgeUser(ctx, alice); err != nil {
		t.Fatalf("PurgeUser() error = %v", err)
	}
	if list, err := svc.List(ctx, alice, time.Time{}); err != nil || len(list) != 0 {
		t.Fatalf("alice still has %d vitals (err=%v)", len(list), err)
	}
	if list, err := svc.List(ctx, bob, time.Time{}); err != nil || len(list) != 1 {
		t.Fatalf("bob should keep his 1 vital, got %d (err=%v)", len(list), err)
	}
}
