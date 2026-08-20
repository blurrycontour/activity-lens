package plans

import (
	"context"
	"errors"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// These run against the real migrated schema (newTestService), same reasoning
// as workout/sharing_test.go: the authorization predicate lives in SQL, so a
// fake repository would test nothing.

func TestAPrivatePlanIsInvisibleToEveryoneButItsOwner(t *testing.T) {
	s, _ := newTestService(t)
	p := samplePlan(t, s, 1)

	if _, _, err := s.GetViewablePlan(context.Background(), 2, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetViewablePlan() by a stranger error = %v, want ErrNotFound", err)
	}
	got, isOwner, err := s.GetViewablePlan(context.Background(), 1, p.ID)
	if err != nil {
		t.Fatalf("GetViewablePlan() by the owner error = %v", err)
	}
	if !isOwner || got.ID != p.ID {
		t.Fatalf("GetViewablePlan() by the owner = %+v, isOwner=%v", got, isOwner)
	}
}

func TestMakingAPlanPublicLetsAnyoneReadIt(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)

	if err := s.SetPlanVisibility(ctx, 1, p.ID, workout.VisibilityPublic); err != nil {
		t.Fatalf("SetPlanVisibility() error = %v", err)
	}
	got, isOwner, err := s.GetViewablePlan(ctx, 2, p.ID)
	if err != nil {
		t.Fatalf("GetViewablePlan() by a stranger error = %v", err)
	}
	if isOwner {
		t.Fatal("GetViewablePlan() reported the stranger as owner")
	}
	// Redacted: the note is gone, but the plan's actual content — what makes
	// it worth reading — is not.
	if got.Notes != "" {
		t.Fatalf("Notes = %q, want redacted to empty", got.Notes)
	}
	if len(got.Days) == 0 || len(got.Days[0].Blocks) == 0 {
		t.Fatal("a public plan's structure should not be redacted")
	}
}

func TestADirectShareLetsOnlyThatOnePersonRead(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)

	if err := s.AddPlanShare(ctx, 1, p.ID, 2); err != nil {
		t.Fatalf("AddPlanShare() error = %v", err)
	}
	if _, _, err := s.GetViewablePlan(ctx, 2, p.ID); err != nil {
		t.Fatalf("GetViewablePlan() by the recipient error = %v", err)
	}
	if _, _, err := s.GetViewablePlan(ctx, 3, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetViewablePlan() by a third party error = %v, want ErrNotFound", err)
	}

	if err := s.RemovePlanShare(ctx, 1, p.ID, 2); err != nil {
		t.Fatalf("RemovePlanShare() error = %v", err)
	}
	if _, _, err := s.GetViewablePlan(ctx, 2, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetViewablePlan() after revoke error = %v, want ErrNotFound", err)
	}
}

func TestSharingAPlanWithYourselfIsRejected(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)

	if err := s.AddPlanShare(ctx, 1, p.ID, 1); !errors.Is(err, ErrInvalid) {
		t.Fatalf("AddPlanShare() with yourself error = %v, want ErrInvalid", err)
	}
}

func TestPublicAndSharedPlanFeedsExcludeYourOwn(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	mine := samplePlan(t, s, 1)
	if err := s.SetPlanVisibility(ctx, 1, mine.ID, workout.VisibilityPublic); err != nil {
		t.Fatalf("SetPlanVisibility() error = %v", err)
	}
	theirs := samplePlan(t, s, 2)
	if err := s.SetPlanVisibility(ctx, 2, theirs.ID, workout.VisibilityPublic); err != nil {
		t.Fatalf("SetPlanVisibility() error = %v", err)
	}

	list, err := s.ListPublicPlans(ctx, 1)
	if err != nil {
		t.Fatalf("ListPublicPlans() error = %v", err)
	}
	if len(list) != 1 || list[0].ID != theirs.ID {
		t.Fatalf("ListPublicPlans() = %+v, want just the other user's plan", list)
	}

	shared := samplePlan(t, s, 2)
	if err := s.AddPlanShare(ctx, 2, shared.ID, 1); err != nil {
		t.Fatalf("AddPlanShare() error = %v", err)
	}
	withMe, err := s.ListSharedPlansWithMe(ctx, 1)
	if err != nil {
		t.Fatalf("ListSharedPlansWithMe() error = %v", err)
	}
	if len(withMe) != 1 || withMe[0].ID != shared.ID {
		t.Fatalf("ListSharedPlansWithMe() = %+v, want just the shared plan", withMe)
	}
}

func TestClonePlanCopiesTheStructureWithFreshIdsAndNoSharing(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	src := samplePlan(t, s, 1)
	if err := s.SetPlanVisibility(ctx, 1, src.ID, workout.VisibilityPublic); err != nil {
		t.Fatalf("SetPlanVisibility() error = %v", err)
	}
	if err := s.repo.(*SQLiteRepository).AddPlanShare(ctx, 1, src.ID, 3); err != nil {
		t.Fatalf("AddPlanShare() error = %v", err)
	}

	clone, err := s.ClonePlan(ctx, 2, src.ID)
	if err != nil {
		t.Fatalf("ClonePlan() error = %v", err)
	}
	if clone.ID == src.ID {
		t.Fatal("ClonePlan() returned the same id as the source")
	}
	if clone.UserID != 2 {
		t.Fatalf("clone.UserID = %d, want 2", clone.UserID)
	}
	if clone.Visibility != "" && clone.Visibility != workout.VisibilityPrivate {
		t.Fatalf("clone.Visibility = %q, want private", clone.Visibility)
	}
	if clone.Name != src.Name+" (copy)" {
		t.Fatalf("clone.Name = %q, want %q", clone.Name, src.Name+" (copy)")
	}
	if len(clone.Days) != len(src.Days) || len(clone.Days[0].Blocks) != len(src.Days[0].Blocks) {
		t.Fatalf("clone structure = %+v, want the same shape as the source", clone.Days)
	}
	// New ids throughout, not the source's.
	if clone.Days[0].ID == src.Days[0].ID || clone.Days[0].Blocks[0].ID == src.Days[0].Blocks[0].ID {
		t.Fatal("ClonePlan() reused the source's ids")
	}
	// The clone owns nobody's access but the cloner's — cloning does not carry
	// the source's share list along with it.
	recipients, err := s.PlanShareRecipients(ctx, 2, clone.ID)
	if err != nil {
		t.Fatalf("PlanShareRecipients() error = %v", err)
	}
	if len(recipients) != 0 {
		t.Fatalf("PlanShareRecipients() on a fresh clone = %v, want none", recipients)
	}

	// Editing the clone must not touch the source.
	if _, err := s.ReplaceDays(ctx, 2, clone.ID, []Day{{Name: "Rewritten", Blocks: []Block{}}}); err != nil {
		t.Fatalf("ReplaceDays() on the clone error = %v", err)
	}
	original, _, err := s.GetViewablePlan(ctx, 1, src.ID)
	if err != nil {
		t.Fatalf("GetViewablePlan() on the source error = %v", err)
	}
	if original.Days[0].Name == "Rewritten" {
		t.Fatal("editing the clone changed the source plan")
	}
}

func TestClonePlanRefusesSomethingTheCallerCannotSee(t *testing.T) {
	s, _ := newTestService(t)
	p := samplePlan(t, s, 1)
	if _, err := s.ClonePlan(context.Background(), 2, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ClonePlan() of a private plan by a stranger error = %v, want ErrNotFound", err)
	}
}

// --- Sessions --------------------------------------------------------------

func finishedSession(t *testing.T, s *Service, userID int64, notes string) *Session {
	t.Helper()
	ctx := context.Background()
	p := samplePlan(t, s, userID)
	sess, err := s.StartSession(ctx, userID, p.ID, p.Days[0].ID)
	if err != nil {
		t.Fatalf("StartSession() error = %v", err)
	}
	sess, err = s.FinishSession(ctx, userID, sess.ID, notes, "")
	if err != nil {
		t.Fatalf("FinishSession() error = %v", err)
	}
	return sess
}

func TestAnUnfinishedSessionCannotBeShared(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	sess, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	if err != nil {
		t.Fatalf("StartSession() error = %v", err)
	}

	if err := s.SetSessionVisibility(ctx, 1, sess.ID, workout.VisibilityPublic); !errors.Is(err, ErrInvalid) {
		t.Fatalf("SetSessionVisibility() on an unfinished session error = %v, want ErrInvalid", err)
	}
	if err := s.AddSessionShare(ctx, 1, sess.ID, 2); !errors.Is(err, ErrInvalid) {
		t.Fatalf("AddSessionShare() on an unfinished session error = %v, want ErrInvalid", err)
	}
}

func TestASharedSessionKeepsItsNumbersButNotItsNotes(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	sess := finishedSession(t, s, 1, "felt strong today")

	if err := s.SetSessionVisibility(ctx, 1, sess.ID, workout.VisibilityPublic); err != nil {
		t.Fatalf("SetSessionVisibility() error = %v", err)
	}
	got, isOwner, err := s.GetViewableSession(ctx, 2, sess.ID)
	if err != nil {
		t.Fatalf("GetViewableSession() error = %v", err)
	}
	if isOwner {
		t.Fatal("GetViewableSession() reported a stranger as owner")
	}
	if got.Notes != "" {
		t.Fatalf("Notes = %q, want redacted", got.Notes)
	}
	if got.DoneSets != sess.DoneSets || got.TotalSets != sess.TotalSets {
		t.Fatalf("set tallies = %d/%d, want %d/%d preserved", got.DoneSets, got.TotalSets, sess.DoneSets, sess.TotalSets)
	}
}

func TestDeletingAPlanTakesItsSharesWithIt(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	if err := s.AddPlanShare(ctx, 1, p.ID, 2); err != nil {
		t.Fatalf("AddPlanShare() error = %v", err)
	}
	if err := s.DeletePlan(ctx, 1, p.ID); err != nil {
		t.Fatalf("DeletePlan() error = %v", err)
	}
	// The recipient's access is gone along with the plan — nothing left over
	// in plan_shares for a plan id that no longer exists.
	recipients, err := s.repo.PlanShareRecipients(ctx, 1, p.ID)
	if err == nil && len(recipients) != 0 {
		t.Fatalf("PlanShareRecipients() after delete = %v, want none or ErrNotFound", recipients)
	}
}
