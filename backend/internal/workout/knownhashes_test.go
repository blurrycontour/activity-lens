package workout

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"
)

// seedUpload stores a workout that looks like a file import: content-addressed
// by the hash of the bytes, exactly as parseWorkoutUpload builds it.
func seedUpload(t *testing.T, svc *Service, owner int64, hash string) string {
	t.Helper()
	w, err := svc.Create(context.Background(), owner, Input{
		Name:        "Imported " + hash,
		Type:        TypeRun,
		StartTime:   time.Date(2024, 5, 4, 7, 0, 0, 0, time.UTC),
		Duration:    1800,
		Distance:    5000,
		Source:      SourceUpload,
		ContentHash: hash,
		ExternalID:  hash,
	})
	if err != nil {
		t.Fatalf("Create(%q) error = %v", hash, err)
	}
	return w.ID
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}

// The point of asking is to avoid uploading files the server already has, so
// the answer has to be exact in both directions: a missed hash means a wasted
// upload, and a wrongly reported one means a workout silently never imported.
func TestKnownContentHashesReportsExactlyWhatIsStored(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	seedUpload(t, svc, alice, "aaa")
	seedUpload(t, svc, alice, "bbb")

	known, err := svc.KnownContentHashes(ctx, alice, []string{"aaa", "ccc", "bbb", "ddd"})
	if err != nil {
		t.Fatalf("KnownContentHashes() error = %v", err)
	}
	if len(known) != 2 {
		t.Fatalf("got %d known hashes, want 2: %v", len(known), known)
	}
	for _, want := range []string{"aaa", "bbb"} {
		if !contains(known, want) {
			t.Errorf("stored hash %q was not reported as known: %v", want, known)
		}
	}
	for _, absent := range []string{"ccc", "ddd"} {
		if contains(known, absent) {
			t.Errorf("hash %q was reported as known but was never imported", absent)
		}
	}
}

// Owner-scoped like every other query here. Two people can import the same GPX
// and each get their own workout, so bob's copy must not make alice skip hers —
// that would be a file silently never imported. It is also a small disclosure:
// the answer would otherwise reveal what someone else has.
func TestKnownContentHashesIsPerUser(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	seedUpload(t, svc, bob, "shared-hash")

	known, err := svc.KnownContentHashes(ctx, alice, []string{"shared-hash"})
	if err != nil {
		t.Fatalf("KnownContentHashes() error = %v", err)
	}
	if len(known) != 0 {
		t.Errorf("alice was told bob's file is already hers: %v", known)
	}

	// And bob still sees his own.
	known, err = svc.KnownContentHashes(ctx, bob, []string{"shared-hash"})
	if err != nil || len(known) != 1 {
		t.Errorf("bob's own hash = %v (err = %v), want it reported", known, err)
	}
}

// An empty batch is the normal case for a folder scan that found nothing new,
// so it must be a cheap no-op rather than an error or a full-table scan.
func TestKnownContentHashesWithNoHashes(t *testing.T) {
	known, err := newSharingSvc(t).KnownContentHashes(context.Background(), alice, nil)
	if err != nil {
		t.Fatalf("KnownContentHashes(nil) error = %v", err)
	}
	if len(known) != 0 {
		t.Errorf("got %v, want an empty result", known)
	}
}

// Every hash becomes a bound parameter and SQLite caps those at 999, so an
// unbounded batch would fail deep in the driver with an opaque error. The cap
// turns that into a clear ErrInvalid the handler renders as a 400, and tells
// the client to chunk.
func TestKnownContentHashesRejectsOversizedBatch(t *testing.T) {
	hashes := make([]string, MaxHashBatch+1)
	for i := range hashes {
		hashes[i] = fmt.Sprintf("hash-%d", i)
	}
	_, err := newSharingSvc(t).KnownContentHashes(context.Background(), alice, hashes)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("KnownContentHashes() with %d hashes = %v, want ErrInvalid", len(hashes), err)
	}

	// The limit itself must still be accepted, or clients chunking to exactly
	// MaxHashBatch would fail on every full chunk.
	if _, err := newSharingSvc(t).KnownContentHashes(context.Background(), alice, hashes[:MaxHashBatch]); err != nil {
		t.Errorf("a batch of exactly MaxHashBatch was rejected: %v", err)
	}
}

// Manual workouts carry no content hash. They must never match, or a blank
// hash would collide with every hand-entered workout at once.
func TestKnownContentHashesIgnoresManualWorkouts(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)
	seed(t, svc, alice, "Hand-entered run")

	known, err := svc.KnownContentHashes(ctx, alice, []string{""})
	if err != nil {
		t.Fatalf("KnownContentHashes() error = %v", err)
	}
	if len(known) != 0 {
		t.Errorf("an empty hash matched a manual workout: %v", known)
	}
}

// What the preview endpoint uses to say "already imported" before the user
// commits. It has to agree with CreateIdempotent, or the pre-flight list and
// the import result would disagree.
func TestGetBySourceIDMatchesImportBehaviour(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)
	seedUpload(t, svc, alice, "known-hash")

	if _, err := svc.GetBySourceID(ctx, alice, SourceUpload, "known-hash"); err != nil {
		t.Errorf("stored upload not found by its identity: %v", err)
	}
	if _, err := svc.GetBySourceID(ctx, alice, SourceUpload, "new-hash"); !errors.Is(err, ErrNotFound) {
		t.Errorf("unknown hash = %v, want ErrNotFound", err)
	}
	// Another user's identical file is not the caller's duplicate.
	if _, err := svc.GetBySourceID(ctx, bob, SourceUpload, "known-hash"); !errors.Is(err, ErrNotFound) {
		t.Errorf("bob was told alice's file is already his: %v", err)
	}
	// An empty id must not match; it would otherwise be reported as a
	// duplicate of whichever row happens to have no external id.
	if _, err := svc.GetBySourceID(ctx, alice, SourceUpload, ""); !errors.Is(err, ErrNotFound) {
		t.Errorf("empty external id = %v, want ErrNotFound", err)
	}
}
