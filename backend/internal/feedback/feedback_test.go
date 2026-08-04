package feedback

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"testing"

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

// Diagnostics are the bulk of a row and are never shown in a listing, so the
// listing must not carry them — but it does have to say which reports have one.
func TestListOmitsDiagnosticsButReportsTheirPresence(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))

	if _, err := svc.Create(ctx, 1, "ada", Input{Message: "with logs", Diagnostics: `{"logs":["boom"]}`}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, 1, "ada", Input{Message: "without logs"}); err != nil {
		t.Fatal(err)
	}

	list, err := svc.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("List() returned %d reports, want 2", len(list))
	}
	for _, r := range list {
		if r.Diagnostics != "" {
			t.Errorf("List() carried a diagnostics blob for %q", r.Message)
		}
		wantHas := r.Message == "with logs"
		if r.HasDiagnostics != wantHas {
			t.Errorf("HasDiagnostics = %v for %q, want %v", r.HasDiagnostics, r.Message, wantHas)
		}
	}

	// Newest first.
	if list[0].Message != "without logs" {
		t.Errorf("List()[0] = %q, want the most recent report", list[0].Message)
	}

	full, err := svc.Get(ctx, list[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	if full.Diagnostics != `{"logs":["boom"]}` {
		t.Errorf("Get() diagnostics = %q, want the stored blob", full.Diagnostics)
	}
}

// The bounds exist so one submission cannot store an unbounded amount; without
// a test they are the kind of thing a later refactor drops silently.
func TestCreateRejectsOversizedSubmissions(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))

	if _, err := svc.Create(ctx, 1, "ada", Input{Message: "   "}); !errors.Is(err, ErrInvalid) {
		t.Errorf("empty message error = %v, want ErrInvalid", err)
	}
	if _, err := svc.Create(ctx, 1, "ada", Input{Message: strings.Repeat("a", maxMessageRunes+1)}); !errors.Is(err, ErrInvalid) {
		t.Errorf("long message error = %v, want ErrInvalid", err)
	}
	if _, err := svc.Create(ctx, 1, "ada", Input{
		Message:     "ok",
		Diagnostics: strings.Repeat("a", maxDiagnosticsBytes+1),
	}); !errors.Is(err, ErrInvalid) {
		t.Errorf("large diagnostics error = %v, want ErrInvalid", err)
	}
}

// Feedback is keyed by a user id that go-authkit knows nothing about, so
// deleting an account leaves every report behind unless this runs. The same
// invariant store/purge_test.go guards structurally, tested here behaviourally.
func TestPurgeUserRemovesOnlyThatUsersReports(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))

	if _, err := svc.Create(ctx, 1, "ada", Input{Message: "mine"}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, 2, "grace", Input{Message: "someone else's"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.PurgeUser(ctx, 1); err != nil {
		t.Fatal(err)
	}

	list, err := svc.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Username != "grace" {
		t.Fatalf("List() after purge = %v, want only grace's report", list)
	}
}

func TestSetResolvedAndDelete(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))

	r, err := svc.Create(ctx, 1, "ada", Input{Message: "something"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.SetResolved(ctx, r.ID, true); err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(ctx, r.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ResolvedAt == nil {
		t.Error("ResolvedAt is nil after SetResolved(true)")
	}
	if err := svc.SetResolved(ctx, r.ID, false); err != nil {
		t.Fatal(err)
	}
	if got, _ = svc.Get(ctx, r.ID); got.ResolvedAt != nil {
		t.Error("ResolvedAt is set after SetResolved(false)")
	}

	if err := svc.Delete(ctx, r.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Get(ctx, r.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get() after Delete error = %v, want ErrNotFound", err)
	}
	if err := svc.Delete(ctx, r.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("second Delete error = %v, want ErrNotFound", err)
	}
}
