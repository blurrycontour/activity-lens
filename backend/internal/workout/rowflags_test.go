package workout

import (
	"context"
	"fmt"
	"testing"
)

// The counts behind "has photos" and "has comments" in the list filters.
//
// Worth pinning because the query is grouped and chunked: a workout with
// neither must be absent rather than zero-and-present, both counts have to land
// on the right row, and a library larger than one chunk must not lose the rows
// past the first — which is the failure that would only appear on somebody's
// several-hundred-workout library and nowhere in development.
func TestFlagsFor(t *testing.T) {
	ctx := context.Background()
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)

	withBoth := newSocialWorkout(t, svc, 1, "hash-both")
	withComments := newSocialWorkout(t, svc, 1, "hash-comments-only")
	bare := newSocialWorkout(t, svc, 1, "hash-bare")

	for i := 0; i < 2; i++ {
		if _, err := svc.AddComment(ctx, withBoth.ID, 2, fmt.Sprintf("nice %d", i)); err != nil {
			t.Fatalf("AddComment: %v", err)
		}
	}
	if _, err := svc.AddComment(ctx, withComments.ID, 2, "one"); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if err := repo.AddMedia(ctx, Media{
		ID: "m1", WorkoutID: withBoth.ID, UserID: 1, Kind: "photo", Filename: "a.jpg", MIME: "image/jpeg", Bytes: 10,
	}); err != nil {
		t.Fatalf("AddMedia: %v", err)
	}

	got, err := svc.FlagsFor(ctx, []string{withBoth.ID, withComments.ID, bare.ID})
	if err != nil {
		t.Fatalf("FlagsFor: %v", err)
	}
	if f := got[withBoth.ID]; f.Media != 1 || f.Comments != 2 {
		t.Errorf("both = %+v, want {Media:1 Comments:2}", f)
	}
	if f := got[withComments.ID]; f.Media != 0 || f.Comments != 1 {
		t.Errorf("comments only = %+v, want {Media:0 Comments:1}", f)
	}
	if _, ok := got[bare.ID]; ok {
		t.Error("a workout with neither has an entry; absence is how the client reads 'no'")
	}

	// Past one chunk, with the interesting row deliberately at the end.
	ids := make([]string, 0, idChunk+2)
	for i := 0; i < idChunk+1; i++ {
		ids = append(ids, fmt.Sprintf("w_absent_%d", i))
	}
	ids = append(ids, withBoth.ID)
	spread, err := svc.FlagsFor(ctx, ids)
	if err != nil {
		t.Fatalf("FlagsFor (chunked): %v", err)
	}
	if f := spread[withBoth.ID]; f.Media != 1 || f.Comments != 2 {
		t.Errorf("past the chunk boundary = %+v, want {Media:1 Comments:2}", f)
	}
}
