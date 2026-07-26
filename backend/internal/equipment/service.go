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

// LinkedWorkouts returns summaries of the workouts using this equipment.
func (s *Service) LinkedWorkouts(ctx context.Context, userID int64, id string) ([]LinkedWorkout, error) {
	return s.repo.LinkedWorkouts(ctx, userID, id)
}

// SetForWorkout replaces the equipment linked to a workout.
func (s *Service) SetForWorkout(ctx context.Context, userID int64, workoutID string, ids []string) error {
	return s.repo.SetWorkoutEquipment(ctx, userID, workoutID, ids)
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
