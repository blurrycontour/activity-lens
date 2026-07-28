package workout

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/store"
)

// newTestDB opens a temporary SQLite database with the full migration set
// applied, so these tests exercise the real schema (including the partial
// unique index that enforces de-duplication) rather than a hand-written one.
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
	// Migrations must stay safe to re-run on every startup.
	if err := store.MigrateApp(context.Background(), db); err != nil {
		t.Fatalf("MigrateApp() second run error = %v", err)
	}
	return db
}

func TestSQLiteRepositoryRejectsDuplicateExternalID(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	in := importInput("Morning Run", "deadbeef")
	in.ContentHash = "deadbeef"

	first, created, err := svc.CreateIdempotent(ctx, 1, in)
	if err != nil || !created {
		t.Fatalf("first import: created = %v, err = %v", created, err)
	}
	if first.Source != SourceUpload {
		t.Fatalf("Source = %q, want %q", first.Source, SourceUpload)
	}

	second, created, err := svc.CreateIdempotent(ctx, 1, in)
	if err != nil {
		t.Fatalf("second import error = %v", err)
	}
	if created {
		t.Fatal("re-importing the same file should not create a second workout")
	}
	if second.ID != first.ID {
		t.Fatalf("ID = %q, want the existing %q", second.ID, first.ID)
	}

	list, err := svc.List(ctx, 1)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("got %d workouts, want 1", len(list))
	}

	// The index must be a *partial* one: rows without an external id are exempt,
	// so several hand-entered workouts can coexist.
	for i := 0; i < 2; i++ {
		manual := Input{Name: "Manual", Type: TypeRun, StartTime: time.Now(), Duration: 600, Source: SourceManual}
		if _, created, err := svc.CreateIdempotent(ctx, 1, manual); err != nil || !created {
			t.Fatalf("manual insert %d: created = %v, err = %v", i, created, err)
		}
	}
	if list, _ := svc.List(ctx, 1); len(list) != 3 {
		t.Fatalf("got %d workouts, want 3", len(list))
	}
}

func TestSQLiteRepositoryGetByExternalIDNotFound(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	_, err := repo.GetByExternalID(context.Background(), 1, SourceUpload, "missing")
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("error = %v, want ErrNotFound", err)
	}
}

// TestSQLiteRepositoryCreateReportsDuplicate covers the race path: two imports
// of the same file that both miss the lookup and race to insert. Only one wins,
// and the loser gets ErrDuplicate rather than a wrapped driver error.
func TestSQLiteRepositoryCreateReportsDuplicate(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	ctx := context.Background()

	mk := func(id string) *Workout {
		return &Workout{
			ID: id, UserID: 1, Name: "Run", Type: TypeRun, StartTime: time.Now().UTC(),
			Source: SourceUpload, ExternalID: "same-hash",
		}
	}
	if err := repo.Create(ctx, mk("w_first")); err != nil {
		t.Fatalf("first Create() error = %v", err)
	}
	if err := repo.Create(ctx, mk("w_second")); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("second Create() error = %v, want ErrDuplicate", err)
	}
}
