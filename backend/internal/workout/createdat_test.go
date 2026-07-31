package workout

import (
	"context"
	"testing"
	"time"
)

// The client narrows "which ones did that scan import?" to a time window, and
// CreatedAt is the only field that can answer it — StartTime is when the run
// happened, which for an import is usually a different day entirely.
//
// It travels on the *summary* list, which is a separate column set and a
// separate scanner from the detail read. A field present in one and missing from
// the other is the shape of bug that leaves the notification's filter matching
// nothing while every other screen looks fine.
func TestListSummaryCarriesCreatedAt(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	before := time.Now().UTC().Add(-time.Second)
	in := importInput("Morning Run", "hash-created-at")
	in.ContentHash = "hash-created-at"
	// A workout from years ago, imported now: the two timestamps must not be
	// confused for each other.
	in.StartTime = time.Date(2019, 3, 1, 7, 0, 0, 0, time.UTC)
	created, _, err := svc.CreateIdempotent(ctx, 1, in)
	if err != nil {
		t.Fatalf("import: %v", err)
	}
	after := time.Now().UTC().Add(time.Second)

	list, err := repo.ListSummary(ctx, 1)
	if err != nil {
		t.Fatalf("ListSummary: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("got %d workouts, want 1", len(list))
	}
	got := list[0].CreatedAt
	if got.IsZero() {
		t.Fatal("CreatedAt is zero on the summary list; the client's time filter matches nothing")
	}
	if got.Before(before) || got.After(after) {
		t.Errorf("CreatedAt = %v, want between %v and %v", got, before, after)
	}
	if got.Equal(list[0].StartTime) {
		t.Error("CreatedAt is the activity's own time; it must be when it entered the library")
	}

	// And the detail read agrees, so a workout does not appear to have arrived
	// at two different times depending on which screen asked.
	detail, err := repo.Get(ctx, 1, created.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !detail.CreatedAt.Equal(got) {
		t.Errorf("detail CreatedAt = %v, summary = %v; the two reads disagree", detail.CreatedAt, got)
	}
}
