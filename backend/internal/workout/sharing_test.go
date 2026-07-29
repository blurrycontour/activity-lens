package workout

import (
	"context"
	"errors"
	"testing"
	"time"
)

// These tests run against the real migrated schema (newTestDB), because the
// authorization predicate lives in SQL — a fake repository would test nothing.

// unimplementedSharing satisfies the sharing half of Repository for fakes that
// have no business implementing it. Every method panics rather than returning a
// zero value, so a test that unexpectedly depends on sharing fails loudly
// instead of quietly asserting against an empty result.
type unimplementedSharing struct{}

func (unimplementedSharing) GetViewable(context.Context, int64, string) (*Workout, error) {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) ListPublicSummary(context.Context, int64) ([]Workout, error) {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) ListSharedWithMeSummary(context.Context, int64) ([]Workout, error) {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) SetVisibility(context.Context, int64, string, Visibility) error {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) ShareRecipients(context.Context, int64, string) ([]int64, error) {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) ShareCounts(context.Context, int64) (map[string]int, error) {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) AddShare(context.Context, int64, string, int64) error {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) RemoveShare(context.Context, int64, string, int64) error {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) DeleteSharesForUser(context.Context, int64) error {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) DeleteAllForUser(context.Context, int64) ([]string, error) {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}
func (unimplementedSharing) SetRawFilename(context.Context, string, string) error {
	panic("sharing is only exercised against the real schema; see sharing_test.go")
}

const (
	alice int64 = 1
	bob   int64 = 2
	carol int64 = 3
)

// seed creates one workout for owner and returns its id.
func seed(t *testing.T, svc *Service, owner int64, name string) string {
	t.Helper()
	w, err := svc.Create(context.Background(), owner, Input{
		Name:      name,
		Type:      TypeRun,
		StartTime: time.Date(2024, 5, 4, 7, 0, 0, 0, time.UTC),
		Duration:  1800,
		Distance:  5000,
		Notes:     "felt strong today",
		Source:    SourceManual,
	})
	if err != nil {
		t.Fatalf("Create(%q) error = %v", name, err)
	}
	return w.ID
}

func newSharingSvc(t *testing.T) *Service {
	t.Helper()
	return NewService(NewSQLiteRepository(newTestDB(t)))
}

func TestGetViewableAuthorization(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	private := seed(t, svc, alice, "Private run")
	public := seed(t, svc, alice, "Public run")
	shared := seed(t, svc, alice, "Shared run")

	if err := svc.SetVisibility(ctx, alice, public, VisibilityPublic); err != nil {
		t.Fatalf("SetVisibility() error = %v", err)
	}
	if err := svc.AddShare(ctx, alice, shared, bob); err != nil {
		t.Fatalf("AddShare() error = %v", err)
	}

	tests := []struct {
		name      string
		viewer    int64
		id        string
		wantFound bool
		wantOwner bool
	}{
		{"owner sees their private workout", alice, private, true, true},
		{"stranger cannot see a private workout", bob, private, false, false},
		{"stranger sees a public workout", bob, public, true, false},
		{"recipient sees a directly shared workout", bob, shared, true, false},
		{"non-recipient cannot see a directly shared workout", carol, shared, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			w, isOwner, err := svc.GetViewable(ctx, tt.viewer, tt.id)
			if !tt.wantFound {
				if !errors.Is(err, ErrNotFound) {
					t.Fatalf("err = %v, want ErrNotFound", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("GetViewable() error = %v", err)
			}
			if isOwner != tt.wantOwner {
				t.Fatalf("isOwner = %v, want %v", isOwner, tt.wantOwner)
			}
			if w.ID != tt.id {
				t.Fatalf("ID = %q, want %q", w.ID, tt.id)
			}
		})
	}
}

func TestGetViewableRedactsForNonOwner(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	id := seed(t, svc, alice, "Public run")
	if err := svc.SetVisibility(ctx, alice, id, VisibilityPublic); err != nil {
		t.Fatalf("SetVisibility() error = %v", err)
	}

	mine, _, err := svc.GetViewable(ctx, alice, id)
	if err != nil {
		t.Fatalf("GetViewable() as owner error = %v", err)
	}
	if mine.Notes != "felt strong today" {
		t.Fatalf("owner Notes = %q, want them preserved", mine.Notes)
	}
	if mine.Visibility != VisibilityPublic {
		t.Fatalf("owner Visibility = %q, want %q", mine.Visibility, VisibilityPublic)
	}

	theirs, _, err := svc.GetViewable(ctx, bob, id)
	if err != nil {
		t.Fatalf("GetViewable() as stranger error = %v", err)
	}
	if theirs.Notes != "" {
		t.Fatalf("Notes = %q, want redacted for a non-owner", theirs.Notes)
	}
	if theirs.Equipment != nil {
		t.Fatalf("Equipment = %v, want nil for a non-owner", theirs.Equipment)
	}
	if theirs.Visibility != "" {
		t.Fatalf("Visibility = %q, want redacted for a non-owner", theirs.Visibility)
	}
}

func TestListPublicExcludesOwnAndPrivate(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	alicePublic := seed(t, svc, alice, "Alice public")
	seed(t, svc, alice, "Alice private")
	bobPublic := seed(t, svc, bob, "Bob public")

	for _, id := range []string{alicePublic, bobPublic} {
		owner := alice
		if id == bobPublic {
			owner = bob
		}
		if err := svc.SetVisibility(ctx, owner, id, VisibilityPublic); err != nil {
			t.Fatalf("SetVisibility() error = %v", err)
		}
	}

	feed, err := svc.ListPublic(ctx, alice)
	if err != nil {
		t.Fatalf("ListPublic() error = %v", err)
	}
	if len(feed) != 1 || feed[0].ID != bobPublic {
		t.Fatalf("got %d rows (%v), want only Bob's public workout", len(feed), feed)
	}
	if feed[0].Notes != "" {
		t.Fatalf("Notes = %q, want redacted in a feed", feed[0].Notes)
	}
}

func TestListSharedWithMe(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	shared := seed(t, svc, alice, "Shared with Bob")
	seed(t, svc, alice, "Not shared")

	if err := svc.AddShare(ctx, alice, shared, bob); err != nil {
		t.Fatalf("AddShare() error = %v", err)
	}

	feed, err := svc.ListSharedWithMe(ctx, bob)
	if err != nil {
		t.Fatalf("ListSharedWithMe() error = %v", err)
	}
	if len(feed) != 1 || feed[0].ID != shared {
		t.Fatalf("got %d rows, want only the shared workout", len(feed))
	}

	// The owner's own "shared with me" list must stay empty.
	own, err := svc.ListSharedWithMe(ctx, alice)
	if err != nil {
		t.Fatalf("ListSharedWithMe() as owner error = %v", err)
	}
	if len(own) != 0 {
		t.Fatalf("owner sees %d shared workouts, want 0", len(own))
	}
}

func TestSharingMutationsRequireOwnership(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	id := seed(t, svc, alice, "Alice's run")

	if err := svc.SetVisibility(ctx, bob, id, VisibilityPublic); !errors.Is(err, ErrNotFound) {
		t.Fatalf("SetVisibility() by non-owner = %v, want ErrNotFound", err)
	}
	if err := svc.AddShare(ctx, bob, id, carol); !errors.Is(err, ErrNotFound) {
		t.Fatalf("AddShare() by non-owner = %v, want ErrNotFound", err)
	}
	if err := svc.RemoveShare(ctx, bob, id, carol); !errors.Is(err, ErrNotFound) {
		t.Fatalf("RemoveShare() by non-owner = %v, want ErrNotFound", err)
	}
	if _, err := svc.ShareRecipients(ctx, bob, id); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ShareRecipients() by non-owner = %v, want ErrNotFound", err)
	}

	// A rejected mutation must not have changed anything.
	w, err := svc.Get(ctx, alice, id)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if w.Visibility != VisibilityPrivate {
		t.Fatalf("Visibility = %q, want it left private", w.Visibility)
	}
	recipients, err := svc.ShareRecipients(ctx, alice, id)
	if err != nil {
		t.Fatalf("ShareRecipients() error = %v", err)
	}
	if len(recipients) != 0 {
		t.Fatalf("recipients = %v, want none", recipients)
	}
}

func TestAddShareIsIdempotentAndRejectsSelf(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	id := seed(t, svc, alice, "Alice's run")

	for range 2 {
		if err := svc.AddShare(ctx, alice, id, bob); err != nil {
			t.Fatalf("AddShare() error = %v", err)
		}
	}
	recipients, err := svc.ShareRecipients(ctx, alice, id)
	if err != nil {
		t.Fatalf("ShareRecipients() error = %v", err)
	}
	if len(recipients) != 1 || recipients[0] != bob {
		t.Fatalf("recipients = %v, want exactly [bob]", recipients)
	}

	if err := svc.AddShare(ctx, alice, id, alice); !errors.Is(err, ErrInvalid) {
		t.Fatalf("self-share = %v, want ErrInvalid", err)
	}
}

func TestDeletingWorkoutCascadesShares(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	id := seed(t, svc, alice, "Alice's run")
	if err := svc.AddShare(ctx, alice, id, bob); err != nil {
		t.Fatalf("AddShare() error = %v", err)
	}
	if err := svc.Delete(ctx, alice, id); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	feed, err := svc.ListSharedWithMe(ctx, bob)
	if err != nil {
		t.Fatalf("ListSharedWithMe() error = %v", err)
	}
	if len(feed) != 0 {
		t.Fatalf("Bob still sees %d shared workouts after the owner deleted it", len(feed))
	}
}

func TestShareCounts(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	two := seed(t, svc, alice, "Shared twice")
	one := seed(t, svc, alice, "Shared once")
	seed(t, svc, alice, "Not shared")
	other := seed(t, svc, bob, "Bob's run")

	for _, target := range []int64{bob, carol} {
		if err := svc.AddShare(ctx, alice, two, target); err != nil {
			t.Fatalf("AddShare() error = %v", err)
		}
	}
	if err := svc.AddShare(ctx, alice, one, bob); err != nil {
		t.Fatalf("AddShare() error = %v", err)
	}
	if err := svc.AddShare(ctx, bob, other, carol); err != nil {
		t.Fatalf("AddShare() error = %v", err)
	}

	counts, err := svc.ShareCounts(ctx, alice)
	if err != nil {
		t.Fatalf("ShareCounts() error = %v", err)
	}
	if counts[two] != 2 {
		t.Fatalf("counts[two] = %d, want 2", counts[two])
	}
	if counts[one] != 1 {
		t.Fatalf("counts[one] = %d, want 1", counts[one])
	}
	if _, ok := counts[other]; ok {
		t.Fatal("ShareCounts leaked another user's workout")
	}
}

// Visibility has its own endpoint precisely so no edit path can change it; this
// pins that the ordinary name/notes patch leaves it alone.
func TestUpdateDoesNotResetVisibility(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	id := seed(t, svc, alice, "Alice's run")
	if err := svc.SetVisibility(ctx, alice, id, VisibilityPublic); err != nil {
		t.Fatalf("SetVisibility() error = %v", err)
	}

	name := "Renamed"
	if _, err := svc.Update(ctx, alice, id, Patch{Name: &name}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	w, err := svc.Get(ctx, alice, id)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if w.Name != name {
		t.Fatalf("Name = %q, want %q", w.Name, name)
	}
	if w.Visibility != VisibilityPublic {
		t.Fatalf("Visibility = %q, want it still public after an unrelated edit", w.Visibility)
	}
}

func TestPurgeUserShares(t *testing.T) {
	ctx := context.Background()
	svc := newSharingSvc(t)

	id := seed(t, svc, alice, "Alice's run")
	if err := svc.AddShare(ctx, alice, id, bob); err != nil {
		t.Fatalf("AddShare() error = %v", err)
	}
	if err := svc.PurgeUserShares(ctx, bob); err != nil {
		t.Fatalf("PurgeUserShares() error = %v", err)
	}
	recipients, err := svc.ShareRecipients(ctx, alice, id)
	if err != nil {
		t.Fatalf("ShareRecipients() error = %v", err)
	}
	if len(recipients) != 0 {
		t.Fatalf("recipients = %v, want none after the account was purged", recipients)
	}
}
