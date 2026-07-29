package workout

import (
	"context"
	"fmt"
)

// Sharing business rules. The service is where redaction happens, so every
// path that can hand a workout to someone who does not own it strips the
// owner-private fields — an API handler cannot leak them by omission.

// GetViewable returns a workout viewerID may read, redacted unless they own it.
// isOwner tells the caller whether to offer edit controls.
func (s *Service) GetViewable(ctx context.Context, viewerID int64, id string) (w *Workout, isOwner bool, err error) {
	w, err = s.repo.GetViewable(ctx, viewerID, id)
	if err != nil {
		return nil, false, err
	}
	isOwner = w.UserID == viewerID
	if !isOwner {
		w.Redact()
	}
	return w, isOwner, nil
}

// ListPublic returns other users' public workouts, redacted.
func (s *Service) ListPublic(ctx context.Context, viewerID int64) ([]Workout, error) {
	return redactAll(s.repo.ListPublicSummary(ctx, viewerID))
}

// ListSharedWithMe returns workouts shared directly with the viewer, redacted.
func (s *Service) ListSharedWithMe(ctx context.Context, viewerID int64) ([]Workout, error) {
	return redactAll(s.repo.ListSharedWithMeSummary(ctx, viewerID))
}

// redactAll strips owner-private fields from every row. Both feed queries
// already exclude the viewer's own workouts, so this is unconditional.
func redactAll(ws []Workout, err error) ([]Workout, error) {
	if err != nil {
		return nil, err
	}
	for i := range ws {
		ws[i].Redact()
	}
	return ws, nil
}

// SetVisibility changes who can see a workout the caller owns.
func (s *Service) SetVisibility(ctx context.Context, ownerID int64, id string, v Visibility) error {
	if !ValidVisibility(v) {
		return fmt.Errorf("%w: unknown visibility %q", ErrInvalid, v)
	}
	return s.repo.SetVisibility(ctx, ownerID, id, v)
}

// ShareRecipients lists the users a workout the caller owns is shared with.
func (s *Service) ShareRecipients(ctx context.Context, ownerID int64, workoutID string) ([]int64, error) {
	return s.repo.ShareRecipients(ctx, ownerID, workoutID)
}

// ShareCounts maps workout id to recipient count for the caller's whole library.
func (s *Service) ShareCounts(ctx context.Context, ownerID int64) (map[string]int, error) {
	return s.repo.ShareCounts(ctx, ownerID)
}

// AddShare grants targetID read access to a workout the caller owns. It is
// idempotent; sharing with yourself is rejected as meaningless rather than
// silently stored, since it would otherwise show up as a phantom recipient.
func (s *Service) AddShare(ctx context.Context, ownerID int64, workoutID string, targetID int64) error {
	if targetID == ownerID {
		return fmt.Errorf("%w: cannot share a workout with yourself", ErrInvalid)
	}
	if targetID <= 0 {
		return fmt.Errorf("%w: invalid user id", ErrInvalid)
	}
	return s.repo.AddShare(ctx, ownerID, workoutID, targetID)
}

// RemoveShare revokes a direct share on a workout the caller owns.
func (s *Service) RemoveShare(ctx context.Context, ownerID int64, workoutID string, targetID int64) error {
	return s.repo.RemoveShare(ctx, ownerID, workoutID, targetID)
}

// PurgeUserShares removes every share naming a user. go-authkit deletes
// accounts with a bare DELETE and workout_shares has no foreign key to its
// table (an FK would make that delete fail), so this is called explicitly when
// an account goes away.
func (s *Service) PurgeUserShares(ctx context.Context, userID int64) error {
	return s.repo.DeleteSharesForUser(ctx, userID)
}

// PurgeUserWorkouts deletes everything a user owns and returns the workout ids,
// so the caller can remove the archived upload files that go with them. Called
// when an account is deleted, for the same reason as PurgeUserShares: authkit
// removes the account without knowing this schema exists.
func (s *Service) PurgeUserWorkouts(ctx context.Context, userID int64) ([]string, error) {
	return s.repo.DeleteAllForUser(ctx, userID)
}
