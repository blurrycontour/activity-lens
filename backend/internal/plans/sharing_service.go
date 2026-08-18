package plans

import (
	"context"
	"fmt"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// Sharing business rules for plans and sessions, mirroring
// workout/sharing_service.go: this is where redaction happens, so every path
// that can hand one of these to someone who does not own it strips the
// owner-private fields before an API handler ever sees it.

// --- Plans -----------------------------------------------------------------

// GetViewablePlan returns a plan viewerID may read, redacted unless they own
// it. isOwner tells the caller whether to offer edit controls.
func (s *Service) GetViewablePlan(ctx context.Context, viewerID int64, id string) (p *Plan, isOwner bool, err error) {
	p, err = s.repo.GetViewablePlan(ctx, viewerID, id)
	if err != nil {
		return nil, false, err
	}
	isOwner = p.UserID == viewerID
	if !isOwner {
		p.Redact()
	}
	return p, isOwner, nil
}

// ListPublicPlans returns other users' public plans, redacted.
func (s *Service) ListPublicPlans(ctx context.Context, viewerID int64) ([]Plan, error) {
	list, err := s.repo.ListPublicPlans(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Redact()
	}
	return list, nil
}

// ListSharedPlansWithMe returns plans shared directly with the viewer, redacted.
func (s *Service) ListSharedPlansWithMe(ctx context.Context, viewerID int64) ([]Plan, error) {
	list, err := s.repo.ListSharedPlansWithMe(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Redact()
	}
	return list, nil
}

// SetPlanVisibility changes who can see a plan the caller owns.
func (s *Service) SetPlanVisibility(ctx context.Context, ownerID int64, id string, v workout.Visibility) error {
	if !workout.ValidVisibility(v) {
		return fmt.Errorf("%w: unknown visibility %q", ErrInvalid, v)
	}
	return s.repo.SetPlanVisibility(ctx, ownerID, id, v)
}

// PlanShareRecipients lists the users a plan the caller owns is shared with.
func (s *Service) PlanShareRecipients(ctx context.Context, ownerID int64, planID string) ([]int64, error) {
	return s.repo.PlanShareRecipients(ctx, ownerID, planID)
}

// PlanShareCounts maps plan id to recipient count for the caller's library.
func (s *Service) PlanShareCounts(ctx context.Context, ownerID int64) (map[string]int, error) {
	return s.repo.PlanShareCounts(ctx, ownerID)
}

// AddPlanShare grants targetID read access to a plan the caller owns.
func (s *Service) AddPlanShare(ctx context.Context, ownerID int64, planID string, targetID int64) error {
	if targetID == ownerID {
		return fmt.Errorf("%w: cannot share a plan with yourself", ErrInvalid)
	}
	if targetID <= 0 {
		return fmt.Errorf("%w: invalid user id", ErrInvalid)
	}
	return s.repo.AddPlanShare(ctx, ownerID, planID, targetID)
}

// RemovePlanShare revokes a direct share on a plan the caller owns.
func (s *Service) RemovePlanShare(ctx context.Context, ownerID int64, planID string, targetID int64) error {
	return s.repo.RemovePlanShare(ctx, ownerID, planID, targetID)
}

// ListPlansSharedByMeWith returns the caller's own plans sent to one person.
// Not redacted: these are the caller's own.
func (s *Service) ListPlansSharedByMeWith(ctx context.Context, ownerID, recipientID int64) ([]Plan, error) {
	return s.repo.ListPlansSharedByMeWith(ctx, ownerID, recipientID)
}

// PlanShareRecipientsByPlan maps the caller's shared plans to their recipients.
func (s *Service) PlanShareRecipientsByPlan(ctx context.Context, ownerID int64) (map[string][]int64, error) {
	return s.repo.PlanShareRecipientsByPlan(ctx, ownerID)
}

// ListSessionsSharedByMeWith mirrors ListPlansSharedByMeWith.
func (s *Service) ListSessionsSharedByMeWith(ctx context.Context, ownerID, recipientID int64) ([]Session, error) {
	return s.repo.ListSessionsSharedByMeWith(ctx, ownerID, recipientID)
}

// SessionShareCounts maps session id to recipient count for the caller.
func (s *Service) SessionShareCounts(ctx context.Context, ownerID int64) (map[string]int, error) {
	return s.repo.SessionShareCounts(ctx, ownerID)
}

// SessionShareRecipientsBySession mirrors PlanShareRecipientsByPlan.
func (s *Service) SessionShareRecipientsBySession(ctx context.Context, ownerID int64) (map[string][]int64, error) {
	return s.repo.SessionShareRecipientsBySession(ctx, ownerID)
}

// ListPlans and ListSessions for a profile go through the feed queries above.

// ClonePlan copies a plan the caller can see (their own, shared with them, or
// public) into a brand-new plan they own, with fresh ids throughout and no
// visibility or share list carried over — a clone starts private, like any
// other new plan.
//
// The day tree is copied by blanking every id and handing it to ReplaceDays,
// which already knows how to fill in missing ids (normalizeDays' idOr) for a
// freshly added row in the editor. Cloning is just that same path with a
// whole tree of "freshly added" rows at once, rather than a second id-minting
// scheme to keep in sync with the first.
func (s *Service) ClonePlan(ctx context.Context, viewerID int64, id string) (*Plan, error) {
	src, err := s.repo.GetViewablePlan(ctx, viewerID, id)
	if err != nil {
		return nil, err
	}
	name := src.Name
	if src.UserID != viewerID {
		name += " (copy)"
	}
	p := &Plan{
		ID:     newID("pl"),
		UserID: viewerID,
		Name:   clip(name, MaxNameLen),
		Notes:  src.Notes,
		Days:   []Day{},
	}
	if err := s.repo.CreatePlan(ctx, p); err != nil {
		return nil, err
	}
	days := blankDayIDs(src.Days)
	if _, err := s.ReplaceDays(ctx, viewerID, p.ID, days); err != nil {
		return nil, err
	}
	return s.repo.GetPlan(ctx, viewerID, p.ID)
}

// blankDayIDs strips every id from a day tree so ReplaceDays mints fresh ones,
// rather than the clone silently sharing ids with its source.
func blankDayIDs(days []Day) []Day {
	out := make([]Day, len(days))
	for i, d := range days {
		blocks := make([]Block, len(d.Blocks))
		for j, b := range d.Blocks {
			opts := make([]Exercise, len(b.Options))
			for k, e := range b.Options {
				e.ID = ""
				opts[k] = e
			}
			b.ID = ""
			b.Options = opts
			blocks[j] = b
		}
		d.ID = ""
		d.Blocks = blocks
		out[i] = d
	}
	return out
}

// --- Sessions ------------------------------------------------------------

// GetViewableSession returns a session viewerID may read, redacted unless
// they own it.
func (s *Service) GetViewableSession(ctx context.Context, viewerID int64, id string) (sess *Session, isOwner bool, err error) {
	sess, err = s.repo.GetViewableSession(ctx, viewerID, id)
	if err != nil {
		return nil, false, err
	}
	isOwner = sess.UserID == viewerID
	if !isOwner {
		sess.Redact()
	}
	return sess, isOwner, nil
}

// ListPublicSessions returns other users' public, finished sessions, redacted.
func (s *Service) ListPublicSessions(ctx context.Context, viewerID int64) ([]Session, error) {
	list, err := s.repo.ListPublicSessions(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Redact()
	}
	return list, nil
}

// ListSharedSessionsWithMe returns sessions shared directly with the viewer, redacted.
func (s *Service) ListSharedSessionsWithMe(ctx context.Context, viewerID int64) ([]Session, error) {
	list, err := s.repo.ListSharedSessionsWithMe(ctx, viewerID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Redact()
	}
	return list, nil
}

// errSessionNotFinished is returned when sharing is attempted on a session
// still in progress. Framed as ErrInvalid rather than a new sentinel: it is a
// bad request, not a missing resource, and the caller already knows to map
// ErrInvalid to a 400.
var errSessionNotFinished = fmt.Errorf("%w: only a finished session can be shared", ErrInvalid)

// SetSessionVisibility changes who can see a session the caller owns. Only a
// finished session has anything to show, so an unfinished one is rejected
// outright rather than silently doing nothing — the repository would also
// refuse it (finished_at IS NOT NULL is part of the update's WHERE), but the
// error here says why, instead of reading as "no such session".
func (s *Service) SetSessionVisibility(ctx context.Context, ownerID int64, id string, v workout.Visibility) error {
	if !workout.ValidVisibility(v) {
		return fmt.Errorf("%w: unknown visibility %q", ErrInvalid, v)
	}
	sess, err := s.repo.GetSession(ctx, ownerID, id)
	if err != nil {
		return err
	}
	if sess.FinishedAt == "" {
		return errSessionNotFinished
	}
	return s.repo.SetSessionVisibility(ctx, ownerID, id, v)
}

// SessionShareRecipients lists who a session the caller owns is shared with.
func (s *Service) SessionShareRecipients(ctx context.Context, ownerID int64, sessionID string) ([]int64, error) {
	return s.repo.SessionShareRecipients(ctx, ownerID, sessionID)
}

// AddSessionShare grants targetID read access to a finished session the
// caller owns; see SetSessionVisibility for why an unfinished one is refused.
func (s *Service) AddSessionShare(ctx context.Context, ownerID int64, sessionID string, targetID int64) error {
	if targetID == ownerID {
		return fmt.Errorf("%w: cannot share a session with yourself", ErrInvalid)
	}
	if targetID <= 0 {
		return fmt.Errorf("%w: invalid user id", ErrInvalid)
	}
	sess, err := s.repo.GetSession(ctx, ownerID, sessionID)
	if err != nil {
		return err
	}
	if sess.FinishedAt == "" {
		return errSessionNotFinished
	}
	return s.repo.AddSessionShare(ctx, ownerID, sessionID, targetID)
}

// RemoveSessionShare revokes a direct share on a session the caller owns.
func (s *Service) RemoveSessionShare(ctx context.Context, ownerID int64, sessionID string, targetID int64) error {
	return s.repo.RemoveSessionShare(ctx, ownerID, sessionID, targetID)
}
