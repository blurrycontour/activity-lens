package equipment

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

// ErrInvalid is returned for validation failures on caller-supplied input.
var ErrInvalid = errors.New("equipment: invalid input")

// Service holds equipment business rules on top of a Repository.
type Service struct {
	repo Repository
}

// NewService builds an equipment service.
func NewService(repo Repository) *Service { return &Service{repo: repo} }

func normalizeType(t string) string {
	t = strings.ToLower(strings.TrimSpace(t))
	if t == "" || !ValidType(t) {
		return "other"
	}
	return t
}

// Create validates input, persists and returns the equipment.
func (s *Service) Create(ctx context.Context, userID int64, in Input) (*Equipment, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, fmt.Errorf("%w: name is required", ErrInvalid)
	}
	e := &Equipment{
		ID:      newID(),
		UserID:  userID,
		Name:    name,
		Type:    normalizeType(in.Type),
		Brand:   strings.TrimSpace(in.Brand),
		Model:   strings.TrimSpace(in.Model),
		Notes:   strings.TrimSpace(in.Notes),
		Retired: in.Retired,

		RetireAtKm: max(in.RetireAtKm, 0),
	}
	if err := s.repo.Create(ctx, e); err != nil {
		return nil, err
	}
	return e, nil
}

// Get returns a single piece of equipment owned by the user.
func (s *Service) Get(ctx context.Context, userID int64, id string) (*Equipment, error) {
	return s.repo.Get(ctx, userID, id)
}

// List returns all of the user's equipment.
func (s *Service) List(ctx context.Context, userID int64) ([]Equipment, error) {
	return s.repo.List(ctx, userID)
}

// Update applies a partial edit to equipment the user owns.
func (s *Service) Update(ctx context.Context, userID int64, id string, p Patch) (*Equipment, error) {
	e, err := s.repo.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		name := strings.TrimSpace(*p.Name)
		if name == "" {
			return nil, fmt.Errorf("%w: name cannot be empty", ErrInvalid)
		}
		e.Name = name
	}
	if p.Type != nil {
		e.Type = normalizeType(*p.Type)
	}
	if p.Brand != nil {
		e.Brand = strings.TrimSpace(*p.Brand)
	}
	if p.Model != nil {
		e.Model = strings.TrimSpace(*p.Model)
	}
	if p.Notes != nil {
		e.Notes = strings.TrimSpace(*p.Notes)
	}
	if p.RetireAtKm != nil {
		e.RetireAtKm = max(*p.RetireAtKm, 0)
	}
	if p.Retired != nil {
		e.Retired = *p.Retired
	}
	if err := s.repo.Update(ctx, e); err != nil {
		return nil, err
	}
	return e, nil
}

// Delete removes equipment the user owns. Its workout associations are removed
// by the ON DELETE CASCADE on workout_equipment.
func (s *Service) Delete(ctx context.Context, userID int64, id string) error {
	return s.repo.Delete(ctx, userID, id)
}

// PurgeUser removes a user's entire gear inventory, for account deletion.
func (s *Service) PurgeUser(ctx context.Context, userID int64) error {
	return s.repo.DeleteAllForUser(ctx, userID)
}

// LinkedWorkouts returns summaries of the workouts using this equipment.
func (s *Service) LinkedWorkouts(ctx context.Context, userID int64, id string) ([]LinkedWorkout, error) {
	return s.repo.LinkedWorkouts(ctx, userID, id)
}

// SetForWorkout replaces the equipment linked to a workout.
func (s *Service) SetForWorkout(ctx context.Context, userID int64, workoutID string, ids []string) error {
	return s.repo.SetWorkoutEquipment(ctx, userID, workoutID, ids)
}

// MaxLinkBatch caps one call to LinkWorkouts. Adding gear to a whole season at
// once is a reasonable thing to want; a list long enough to hold the statement
// open on the single write connection is not.
const MaxLinkBatch = 200

// LinkWorkouts adds workouts to a piece of equipment, leaving whatever else
// those workouts already carry alone.
func (s *Service) LinkWorkouts(ctx context.Context, userID int64, id string, workoutIDs []string) (int, error) {
	// Duplicates in the request would each be counted, and the count is what
	// the page reports back to the user.
	seen := make(map[string]struct{}, len(workoutIDs))
	ids := make([]string, 0, len(workoutIDs))
	for _, w := range workoutIDs {
		w = strings.TrimSpace(w)
		if w == "" {
			continue
		}
		if _, dup := seen[w]; dup {
			continue
		}
		seen[w] = struct{}{}
		ids = append(ids, w)
	}
	if len(ids) > MaxLinkBatch {
		return 0, fmt.Errorf("%w: at most %d workouts at a time", ErrInvalid, MaxLinkBatch)
	}
	return s.repo.LinkWorkouts(ctx, userID, id, ids)
}

// UnlinkWorkout removes one workout from a piece of equipment.
func (s *Service) UnlinkWorkout(ctx context.Context, userID int64, id, workoutID string) error {
	return s.repo.UnlinkWorkout(ctx, userID, id, workoutID)
}

// ForWorkout returns the equipment linked to a workout.
func (s *Service) ForWorkout(ctx context.Context, userID int64, workoutID string) ([]Equipment, error) {
	return s.repo.ForWorkout(ctx, userID, workoutID)
}

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "e_" + hex.EncodeToString(b)
}
