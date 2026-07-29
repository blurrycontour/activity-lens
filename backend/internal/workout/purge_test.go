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

// The recorded filename is what makes "is there an original to download"
// answerable from the row the detail request already loaded, and what lets the
// download offer the file back under its own name.
func TestSetRawFilenameRoundTrips(t *testing.T) {
	ctx := context.Background()
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	id := seed(t, svc, alice, "Imported run")

	// Nothing archived yet: the default must be empty, not NULL, or the scan
	// into a string would fail.
	before, err := repo.Get(ctx, alice, id)
	if err != nil {
		t.Fatal(err)
	}
	if before.RawFilename != "" {
		t.Errorf("a fresh workout reports RawFilename = %q, want empty", before.RawFilename)
	}

	if err := svc.RecordRawFilename(ctx, id, "morning run.gpx"); err != nil {
		t.Fatalf("RecordRawFilename() error = %v", err)
	}
	after, err := repo.Get(ctx, alice, id)
	if err != nil {
		t.Fatal(err)
	}
	if after.RawFilename != "morning run.gpx" {
		t.Errorf("RawFilename = %q, want %q", after.RawFilename, "morning run.gpx")
	}
}

// Editing a workout must not silently discard the link to its archived file.
// raw_filename is absent from both insertCols and the UPDATE in Update, so this
// pins that a patch leaves it alone.
func TestUpdateDoesNotClearRawFilename(t *testing.T) {
	ctx := context.Background()
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	id := seed(t, svc, alice, "Imported run")

	if err := svc.RecordRawFilename(ctx, id, "ride.tcx"); err != nil {
		t.Fatal(err)
	}
	renamed := "Evening ride"
	if _, err := svc.Update(ctx, alice, id, Patch{Name: &renamed}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	got, err := repo.Get(ctx, alice, id)
	if err != nil {
		t.Fatal(err)
	}
	if got.RawFilename != "ride.tcx" {
		t.Errorf("after a rename RawFilename = %q, want it untouched", got.RawFilename)
	}
}

// The original file is the owner's. Redact is what keeps hasOriginal false for
// everyone else, so a shared workout must never carry the filename through.
func TestRedactClearsRawFilename(t *testing.T) {
	ctx := context.Background()
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	id := seed(t, svc, alice, "Shared run")

	if err := svc.RecordRawFilename(ctx, id, "private-folder-name.gpx"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SetVisibility(ctx, alice, id, VisibilityPublic); err != nil {
		t.Fatal(err)
	}

	asOwner, isOwner, err := svc.GetViewable(ctx, alice, id)
	if err != nil || !isOwner {
		t.Fatalf("owner read failed: %v (isOwner = %v)", err, isOwner)
	}
	if asOwner.RawFilename == "" {
		t.Error("the owner lost their own RawFilename")
	}

	asStranger, isOwner, err := svc.GetViewable(ctx, bob, id)
	if err != nil {
		t.Fatal(err)
	}
	if isOwner {
		t.Fatal("bob was reported as the owner")
	}
	if asStranger.RawFilename != "" {
		t.Errorf("a non-owner sees RawFilename = %q", asStranger.RawFilename)
	}
}
