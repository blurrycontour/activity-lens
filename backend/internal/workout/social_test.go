package workout

import (
	"context"
	"errors"
	"strings"
	"testing"
)

// Comments and reactions, against the real schema.
//
// Everything here is a rule that lives in SQL rather than in Go, which is
// exactly the set worth testing: the author check is a WHERE clause, "one
// reaction each" is a primary key with an upsert on it, and the shared-ness
// gate is a three-table predicate. A fake repository would reimplement all
// three and prove nothing about the statements that actually run.

func newSocialWorkout(t *testing.T, svc *Service, ownerID int64, hash string) *Workout {
	t.Helper()
	w, err := svc.Create(context.Background(), ownerID, importInput("Long run", hash))
	if err != nil {
		t.Fatalf("create workout: %v", err)
	}
	return w
}

func TestCommentCRUD(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-comments")

	c, err := svc.AddComment(ctx, WorkoutSubject(wk.ID), 2, "  strong finish  ")
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	// Trimmed on the way in, so a comment padded with newlines is not a hole
	// in the thread.
	if c.Body != "strong finish" {
		t.Errorf("body = %q, want it trimmed", c.Body)
	}
	if !strings.HasPrefix(c.ID, "c_") {
		t.Errorf("id = %q, want a c_ prefix", c.ID)
	}

	edited, err := svc.EditComment(ctx, WorkoutSubject(wk.ID), c.ID, 2, "strong finish!")
	if err != nil {
		t.Fatalf("EditComment: %v", err)
	}
	if edited.Body != "strong finish!" {
		t.Errorf("body = %q after edit", edited.Body)
	}
	if !edited.UpdatedAt.After(edited.CreatedAt) && edited.UpdatedAt.Before(edited.CreatedAt) {
		t.Errorf("updatedAt went backwards")
	}

	list, err := svc.Comments(ctx, WorkoutSubject(wk.ID))
	if err != nil || len(list) != 1 {
		t.Fatalf("Comments() = %d rows, %v; want 1", len(list), err)
	}

	if err := svc.RemoveComment(ctx, WorkoutSubject(wk.ID), c.ID, 2, false); err != nil {
		t.Fatalf("RemoveComment: %v", err)
	}
	if list, _ := svc.Comments(ctx, WorkoutSubject(wk.ID)); len(list) != 0 {
		t.Errorf("comment survived deletion")
	}
}

// The one that matters: a comment is only editable and deletable by the person
// who wrote it. Both checks are a WHERE clause, so a dropped predicate is
// silent — it just starts working for everybody.
func TestCommentIsAuthorScoped(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-author")

	c, err := svc.AddComment(ctx, WorkoutSubject(wk.ID), 2, "nice one")
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}

	if _, err := svc.EditComment(ctx, WorkoutSubject(wk.ID), c.ID, 3, "rewritten"); !errors.Is(err, ErrCommentNotFound) {
		t.Errorf("stranger edit err = %v, want ErrCommentNotFound", err)
	}
	if err := svc.RemoveComment(ctx, WorkoutSubject(wk.ID), c.ID, 3, false); !errors.Is(err, ErrCommentNotFound) {
		t.Errorf("stranger delete err = %v, want ErrCommentNotFound", err)
	}
	// Even the workout's owner may not rewrite somebody's words — only remove
	// them, and only through the moderation flag.
	if _, err := svc.EditComment(ctx, WorkoutSubject(wk.ID), c.ID, 1, "rewritten"); !errors.Is(err, ErrCommentNotFound) {
		t.Errorf("owner edit err = %v, want ErrCommentNotFound", err)
	}
	if err := svc.RemoveComment(ctx, WorkoutSubject(wk.ID), c.ID, 1, true); err != nil {
		t.Errorf("owner moderation delete: %v", err)
	}
}

// A comment id valid on one workout must not be reachable through another's
// URL. The scoping is a second WHERE column and nothing else would catch it.
func TestCommentIsWorkoutScoped(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	mine := newSocialWorkout(t, svc, 1, "hash-scope-a")
	other := newSocialWorkout(t, svc, 1, "hash-scope-b")

	c, err := svc.AddComment(ctx, WorkoutSubject(mine.ID), 2, "hello")
	if err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if err := svc.RemoveComment(ctx, WorkoutSubject(other.ID), c.ID, 2, false); !errors.Is(err, ErrCommentNotFound) {
		t.Errorf("cross-workout delete err = %v, want ErrCommentNotFound", err)
	}
}

func TestCommentValidation(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-validate")

	if _, err := svc.AddComment(ctx, WorkoutSubject(wk.ID), 2, "   \n  "); !errors.Is(err, ErrInvalid) {
		t.Errorf("empty comment err = %v, want ErrInvalid", err)
	}
	// Counted in runes: a 2000-character comment in a multi-byte script is the
	// same amount of writing as one in ASCII, and a byte limit would cut it to
	// a third.
	long := strings.Repeat("é", MaxCommentLength)
	if _, err := svc.AddComment(ctx, WorkoutSubject(wk.ID), 2, long); err != nil {
		t.Errorf("comment at the limit was rejected: %v", err)
	}
	if _, err := svc.AddComment(ctx, WorkoutSubject(wk.ID), 2, long+"é"); !errors.Is(err, ErrInvalid) {
		t.Errorf("over-long comment err = %v, want ErrInvalid", err)
	}
}

// One reaction each, and picking a second replaces the first rather than
// adding to it. This is the primary key doing the work, so the test is really
// asserting that the upsert targets the right conflict.
func TestReactionIsOnePerPerson(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-reactions")

	if err := svc.SetReaction(ctx, WorkoutSubject(wk.ID), 2, "👏"); err != nil {
		t.Fatalf("SetReaction: %v", err)
	}
	if err := svc.SetReaction(ctx, WorkoutSubject(wk.ID), 2, "🔥"); err != nil {
		t.Fatalf("SetReaction (replace): %v", err)
	}
	if err := svc.SetReaction(ctx, WorkoutSubject(wk.ID), 3, "💪"); err != nil {
		t.Fatalf("SetReaction (other user): %v", err)
	}

	list, err := svc.Reactions(ctx, WorkoutSubject(wk.ID))
	if err != nil {
		t.Fatalf("Reactions: %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("got %d reactions, want 2 — one each", len(list))
	}
	for _, re := range list {
		if re.UserID == 2 && re.Emoji != "🔥" {
			t.Errorf("user 2 reaction = %q, want the replacement", re.Emoji)
		}
	}

	// Deliberately something no plausible future row would add. The first
	// version of this used a rocket, which promptly became a real reaction and
	// turned the assertion into a lie — the failure is what caught the clash.
	if err := svc.SetReaction(ctx, WorkoutSubject(wk.ID), 2, "🦕"); !errors.Is(err, ErrInvalid) {
		t.Errorf("off-list emoji err = %v, want ErrInvalid", err)
	}
	// The allowlist is what the picker offers, so an empty or free-text value
	// must not slip through either.
	if err := svc.SetReaction(ctx, WorkoutSubject(wk.ID), 2, "not an emoji"); !errors.Is(err, ErrInvalid) {
		t.Errorf("free text err = %v, want ErrInvalid", err)
	}
	// Clearing something that is not there is the wanted state already, not an
	// error — a double tap must not fail.
	if err := svc.ClearReaction(ctx, WorkoutSubject(wk.ID), 99); err != nil {
		t.Errorf("clearing an absent reaction: %v", err)
	}
	if err := svc.ClearReaction(ctx, WorkoutSubject(wk.ID), 2); err != nil {
		t.Fatalf("ClearReaction: %v", err)
	}
	if list, _ := svc.Reactions(ctx, WorkoutSubject(wk.ID)); len(list) != 1 {
		t.Errorf("got %d reactions after clearing one, want 1", len(list))
	}
}

// The gate the whole tab hangs on: public counts, a direct share counts, and a
// private workout with neither does not.
func TestIsShared(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-shared")

	shared, err := svc.IsShared(ctx, 1, wk.ID)
	if err != nil {
		t.Fatalf("IsShared: %v", err)
	}
	if shared {
		t.Error("a fresh private workout reported as shared")
	}

	if err := svc.AddShare(ctx, 1, wk.ID, 2); err != nil {
		t.Fatalf("AddShare: %v", err)
	}
	if shared, _ := svc.IsShared(ctx, 1, wk.ID); !shared {
		t.Error("a directly shared workout reported as private")
	}

	if err := svc.RemoveShare(ctx, 1, wk.ID, 2); err != nil {
		t.Fatalf("RemoveShare: %v", err)
	}
	if shared, _ := svc.IsShared(ctx, 1, wk.ID); shared {
		t.Error("an unshared workout still reported as shared")
	}

	if err := svc.SetVisibility(ctx, 1, wk.ID, VisibilityPublic); err != nil {
		t.Fatalf("SetVisibility: %v", err)
	}
	if shared, _ := svc.IsShared(ctx, 1, wk.ID); !shared {
		t.Error("a public workout reported as private")
	}

	// Owner-scoped: asking about somebody else's workout is always false, so a
	// caller who got the id wrong cannot learn anything from the answer.
	if shared, _ := svc.IsShared(ctx, 2, wk.ID); shared {
		t.Error("IsShared answered for a non-owner")
	}
}

// Unsharing keeps the conversation. This is the decision that separates "hide"
// from "delete", and the only thing enforcing it is that nothing deletes.
func TestUnsharingKeepsComments(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-unshare")

	if err := svc.SetVisibility(ctx, 1, wk.ID, VisibilityPublic); err != nil {
		t.Fatalf("SetVisibility: %v", err)
	}
	if _, err := svc.AddComment(ctx, WorkoutSubject(wk.ID), 2, "great pace"); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if err := svc.SetReaction(ctx, WorkoutSubject(wk.ID), 2, "👏"); err != nil {
		t.Fatalf("SetReaction: %v", err)
	}

	if err := svc.SetVisibility(ctx, 1, wk.ID, VisibilityPrivate); err != nil {
		t.Fatalf("SetVisibility back: %v", err)
	}
	if list, _ := svc.Comments(ctx, WorkoutSubject(wk.ID)); len(list) != 1 {
		t.Errorf("unsharing destroyed the comment thread")
	}
	if list, _ := svc.Reactions(ctx, WorkoutSubject(wk.ID)); len(list) != 1 {
		t.Errorf("unsharing destroyed the reactions")
	}
}

// A deleted account takes its comments and reactions with it, including the
// ones on other people's workouts — which no foreign key reaches.
func TestPurgeUserSocial(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-purge")

	if _, err := svc.AddComment(ctx, WorkoutSubject(wk.ID), 2, "from a guest"); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if _, err := svc.AddComment(ctx, WorkoutSubject(wk.ID), 3, "from another"); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if err := svc.SetReaction(ctx, WorkoutSubject(wk.ID), 2, "🔥"); err != nil {
		t.Fatalf("SetReaction: %v", err)
	}

	if err := svc.PurgeUserComments(ctx, 2); err != nil {
		t.Fatalf("PurgeUserComments: %v", err)
	}
	if err := svc.PurgeUserReactions(ctx, 2); err != nil {
		t.Fatalf("PurgeUserReactions: %v", err)
	}

	list, _ := svc.Comments(ctx, WorkoutSubject(wk.ID))
	if len(list) != 1 || list[0].UserID != 3 {
		t.Errorf("purge removed the wrong comments: %+v", list)
	}
	if re, _ := svc.Reactions(ctx, WorkoutSubject(wk.ID)); len(re) != 0 {
		t.Errorf("purge left %d reactions", len(re))
	}
}

// The tests below are about the one thing migration 0038 changed: three kinds
// of subject sharing one pair of tables. What is worth proving is that they
// stay apart — a comment on a plan must not turn up on the workout whose id it
// happens to share — and that "one reaction each" survived becoming three
// partial indexes instead of a primary key.

func TestSubjectsDoNotLeakIntoEachOther(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-subjects")

	// Deliberately the *same id string* on all three. Nothing stops a plan id
	// and a workout id colliding — they come from different generators — and a
	// single (kind, id) column pair would have made them one thread.
	shared := Subject{Kind: SubjectPlan, ID: wk.ID}
	if _, err := svc.AddComment(ctx, WorkoutSubject(wk.ID), 2, "on the workout"); err != nil {
		t.Fatalf("AddComment on workout: %v", err)
	}

	got, err := svc.Comments(ctx, WorkoutSubject(wk.ID))
	if err != nil {
		t.Fatalf("Comments: %v", err)
	}
	if len(got) != 1 || got[0].Body != "on the workout" {
		t.Fatalf("workout thread = %+v, want the one comment", got)
	}
	// The same id read as a plan is a different conversation, and an empty one
	// — the foreign key column differs even though the id does not.
	planThread, err := svc.Comments(ctx, shared)
	if err != nil {
		t.Fatalf("Comments on plan: %v", err)
	}
	if len(planThread) != 0 {
		t.Fatalf("plan thread = %+v, want empty", planThread)
	}
}

func TestOneReactionEachPerSubject(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-reactions-subject")
	subj := WorkoutSubject(wk.ID)

	for _, e := range []string{"👏", "🔥", "💯"} {
		if err := svc.SetReaction(ctx, subj, 2, e); err != nil {
			t.Fatalf("SetReaction %s: %v", e, err)
		}
	}
	got, err := svc.Reactions(ctx, subj)
	if err != nil {
		t.Fatalf("Reactions: %v", err)
	}
	// Three taps, one row: the delete-and-insert that replaced the upsert has
	// to keep the guarantee the primary key used to give.
	if len(got) != 1 || got[0].Emoji != "💯" {
		t.Fatalf("reactions = %+v, want one row holding the last emoji", got)
	}

	if err := svc.ClearReaction(ctx, subj, 2); err != nil {
		t.Fatalf("ClearReaction: %v", err)
	}
	if got, _ := svc.Reactions(ctx, subj); len(got) != 0 {
		t.Fatalf("reactions after clear = %+v, want none", got)
	}
}

func TestDeletingASubjectTakesItsThreadWithIt(t *testing.T) {
	ctx := context.Background()
	svc := NewService(NewSQLiteRepository(newTestDB(t)))
	wk := newSocialWorkout(t, svc, 1, "hash-cascade")
	subj := WorkoutSubject(wk.ID)

	if _, err := svc.AddComment(ctx, subj, 2, "nice one"); err != nil {
		t.Fatalf("AddComment: %v", err)
	}
	if err := svc.SetReaction(ctx, subj, 2, "🔥"); err != nil {
		t.Fatalf("SetReaction: %v", err)
	}
	if err := svc.Delete(ctx, 1, wk.ID); err != nil {
		t.Fatalf("Delete workout: %v", err)
	}
	// The real cascade is the whole reason for three nullable foreign keys
	// rather than one polymorphic column; without it these rows would outlive
	// the thing they were about, unread and unreachable.
	if got, _ := svc.Comments(ctx, subj); len(got) != 0 {
		t.Fatalf("comments after delete = %+v, want none", got)
	}
	if got, _ := svc.Reactions(ctx, subj); len(got) != 0 {
		t.Fatalf("reactions after delete = %+v, want none", got)
	}
}
