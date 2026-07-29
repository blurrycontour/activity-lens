package equipment

import (
	"context"
	"database/sql"
	"path/filepath"
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

// Gear is keyed by a user id that go-authkit knows nothing about, so deleting
// an account leaves the whole inventory behind unless this runs.
func TestDeleteAllForUserRemovesOnlyThatUsersGear(t *testing.T) {
	ctx := context.Background()
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)

	const alice, bob int64 = 1, 2
	for _, name := range []string{"Road shoes", "Trail shoes"} {
		if _, err := svc.Create(ctx, alice, Input{Name: name, Type: "shoes"}); err != nil {
			t.Fatalf("Create(%q) error = %v", name, err)
		}
	}
	if _, err := svc.Create(ctx, bob, Input{Name: "Bob's bike", Type: "bike"}); err != nil {
		t.Fatal(err)
	}

	if err := svc.PurgeUser(ctx, alice); err != nil {
		t.Fatalf("PurgeUser() error = %v", err)
	}

	if got, err := svc.List(ctx, alice); err != nil || len(got) != 0 {
		t.Errorf("alice still has %d items of gear (err = %v)", len(got), err)
	}
	if got, err := svc.List(ctx, bob); err != nil || len(got) != 1 {
		t.Errorf("bob should be untouched, has %d items (err = %v)", len(got), err)
	}
}

// Purging someone who never added gear must succeed rather than report a
// missing row — account deletion calls this unconditionally.
func TestPurgeUserWithNoGear(t *testing.T) {
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	if err := svc.PurgeUser(context.Background(), 99); err != nil {
		t.Errorf("PurgeUser() on an empty inventory: %v", err)
	}
}
