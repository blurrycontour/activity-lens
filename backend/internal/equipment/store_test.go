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

// addWorkout inserts a bare workout row, which is all the link tests need.
func addWorkout(t *testing.T, db *sql.DB, id string, userID int64) {
	t.Helper()
	_, err := db.Exec(
		`INSERT INTO workouts (id, user_id, name, type, start_time, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?)`,
		id, userID, id, "Run", "2026-01-01T08:00:00Z", "2026-01-01T08:00:00Z", "2026-01-01T08:00:00Z")
	if err != nil {
		t.Fatalf("insert workout %q: %v", id, err)
	}
}

// workout_equipment has no owner column of its own — it is a join of two owned
// tables, and the ownership tests inside the statements are the only thing
// standing between the gear page and someone else's library. Worth holding
// down: a link written across users is invisible until it shows up as a
// stranger's run in your shoes' history.
func TestLinkWorkoutsRefusesWhatTheUserDoesNotOwn(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	repo := NewSQLiteRepository(db)
	svc := NewService(repo)

	const alice, bob int64 = 1, 2
	shoes, err := svc.Create(ctx, alice, Input{Name: "Road shoes", Type: "shoes"})
	if err != nil {
		t.Fatal(err)
	}
	addWorkout(t, db, "w_alice", alice)
	addWorkout(t, db, "w_bob", bob)

	// Alice's own workout, Bob's workout, and one that does not exist at all.
	linked, err := svc.LinkWorkouts(ctx, alice, shoes.ID, []string{"w_alice", "w_bob", "w_nope"})
	if err != nil {
		t.Fatalf("LinkWorkouts() error = %v", err)
	}
	if linked != 1 {
		t.Errorf("linked = %d, want 1 — only Alice's own workout", linked)
	}
	got, err := svc.LinkedWorkouts(ctx, alice, shoes.ID)
	if err != nil || len(got) != 1 || got[0].ID != "w_alice" {
		t.Fatalf("linked workouts = %+v (err = %v), want only w_alice", got, err)
	}

	// And Bob cannot reach into Alice's gear at all, even for his own workout.
	if _, err := svc.LinkWorkouts(ctx, bob, shoes.ID, []string{"w_bob"}); err == nil {
		t.Error("LinkWorkouts() as Bob against Alice's shoes: want an error, got nil")
	}
}

// The page sends the whole selection every time, and a double-tap on a slow
// connection sends it twice. Neither may duplicate a link nor miscount.
func TestLinkWorkoutsIsRepeatable(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	svc := NewService(NewSQLiteRepository(db))

	const alice int64 = 1
	shoes, err := svc.Create(ctx, alice, Input{Name: "Road shoes", Type: "shoes"})
	if err != nil {
		t.Fatal(err)
	}
	addWorkout(t, db, "w1", alice)
	addWorkout(t, db, "w2", alice)

	// A duplicate inside one request counts once, too.
	if n, err := svc.LinkWorkouts(ctx, alice, shoes.ID, []string{"w1", "w1", "w2"}); err != nil || n != 2 {
		t.Fatalf("first link = %d (err = %v), want 2", n, err)
	}
	// The second call links nothing new, which is what the page reports.
	if n, err := svc.LinkWorkouts(ctx, alice, shoes.ID, []string{"w1", "w2"}); err != nil || n != 0 {
		t.Fatalf("repeat link = %d (err = %v), want 0", n, err)
	}
	got, _ := svc.LinkedWorkouts(ctx, alice, shoes.ID)
	if len(got) != 2 {
		t.Errorf("linked %d workouts, want 2", len(got))
	}

	// Unlinking is likewise repeatable, and scoped: Bob unlinking Alice's pair
	// must leave it alone.
	if err := svc.UnlinkWorkout(ctx, 2, shoes.ID, "w1"); err != nil {
		t.Fatalf("UnlinkWorkout() as another user: %v", err)
	}
	if got, _ := svc.LinkedWorkouts(ctx, alice, shoes.ID); len(got) != 2 {
		t.Fatalf("another user unlinked Alice's workout, %d left", len(got))
	}
	for range 2 {
		if err := svc.UnlinkWorkout(ctx, alice, shoes.ID, "w1"); err != nil {
			t.Fatalf("UnlinkWorkout() error = %v", err)
		}
	}
	if got, _ := svc.LinkedWorkouts(ctx, alice, shoes.ID); len(got) != 1 {
		t.Errorf("after unlinking w1, %d workouts left, want 1", len(got))
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
