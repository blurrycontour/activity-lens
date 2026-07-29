package workout

import (
	"context"
	"testing"
)

// Deleting an account has to take its workouts with it. Nothing else will:
// go-authkit removes the user row without knowing this table exists, so before
// this existed a deleted user's whole history stayed in the database — and, for
// anything public, stayed visible in other people's feeds.
func TestDeleteAllForUserRemovesOnlyThatUsersWorkouts(t *testing.T) {
	ctx := context.Background()
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)

	first := seed(t, svc, alice, "Alice one")
	second := seed(t, svc, alice, "Alice two")
	survivor := seed(t, svc, bob, "Bob one")

	ids, err := repo.DeleteAllForUser(ctx, alice)
	if err != nil {
		t.Fatalf("DeleteAllForUser() error = %v", err)
	}

	// The ids are the only way to find the archived files on disk afterwards,
	// so returning a short list is as much a leak as leaving the rows behind.
	if len(ids) != 2 {
		t.Fatalf("returned %d ids, want 2: %v", len(ids), ids)
	}
	for _, want := range []string{first, second} {
		if !containsID(ids, want) {
			t.Errorf("id %q missing from the returned list %v", want, ids)
		}
	}

	if got, err := svc.List(ctx, alice); err != nil || len(got) != 0 {
		t.Errorf("alice still has %d workouts (err = %v)", len(got), err)
	}
	if got, err := svc.List(ctx, bob); err != nil || len(got) != 1 {
		t.Fatalf("bob should be untouched, has %d workouts (err = %v)", len(got), err)
	}
	if _, _, err := svc.GetViewable(ctx, bob, survivor); err != nil {
		t.Errorf("bob's own workout became unreadable: %v", err)
	}
}

// A public workout that outlived its owner would keep appearing in everyone
// else's feed, unattributed and impossible to remove from the UI.
func TestDeleteAllForUserClearsSharesAndFeeds(t *testing.T) {
	ctx := context.Background()
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)

	public := seed(t, svc, alice, "Alice public")
	shared := seed(t, svc, alice, "Alice shared")
	if err := svc.SetVisibility(ctx, alice, public, VisibilityPublic); err != nil {
		t.Fatal(err)
	}
	if err := svc.AddShare(ctx, alice, shared, bob); err != nil {
		t.Fatal(err)
	}

	if _, err := repo.DeleteAllForUser(ctx, alice); err != nil {
		t.Fatalf("DeleteAllForUser() error = %v", err)
	}

	if got, err := svc.ListPublic(ctx, bob); err != nil || len(got) != 0 {
		t.Errorf("bob's public feed still shows %d of alice's workouts (err = %v)", len(got), err)
	}
	if got, err := svc.ListSharedWithMe(ctx, bob); err != nil || len(got) != 0 {
		t.Errorf("bob's shared feed still shows %d of alice's workouts (err = %v)", len(got), err)
	}
	// The share rows themselves must be gone, not merely unreachable: the
	// foreign key on workout_shares.workout_id is what removes them, and that
	// only works while foreign_keys=ON is set on the connection.
	var shares int
	if err := repo.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM workout_shares`).Scan(&shares); err != nil {
		t.Fatal(err)
	}
	if shares != 0 {
		t.Errorf("%d share rows survived their workout; is foreign_keys=ON?", shares)
	}
	if _, _, err := svc.GetViewable(ctx, bob, public); err == nil {
		t.Error("a deleted user's public workout is still readable")
	}
}

// Purging a user who never recorded anything must be a no-op, not an error —
// it is the common case for an account created and removed without use.
func TestDeleteAllForUserOnEmptyLibrary(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	ids, err := repo.DeleteAllForUser(context.Background(), carol)
	if err != nil {
		t.Fatalf("DeleteAllForUser() error = %v", err)
	}
	if len(ids) != 0 {
		t.Errorf("returned %v, want no ids", ids)
	}
}

func containsID(ids []string, want string) bool {
	for _, id := range ids {
		if id == want {
			return true
		}
	}
	return false
}
