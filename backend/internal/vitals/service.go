package vitals

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrInvalid is returned for validation failures on caller-supplied input.
var ErrInvalid = errors.New("vitals: invalid input")

// MaxNoteLen bounds a measurement note: enough for context ("left arm, after
// coffee") without becoming a journal entry.
const MaxNoteLen = 200

// Service holds body-vitals business rules on top of a Repository.
type Service struct {
	repo Repository
}

// NewService builds a vitals service.
func NewService(repo Repository) *Service { return &Service{repo: repo} }

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Create validates a measurement, persists and returns it. At least one of a
// weight or a complete blood-pressure reading must be present.
func (s *Service) Create(ctx context.Context, userID int64, in Input) (*Vital, error) {
	when := in.MeasuredAt
	if when.IsZero() {
		when = time.Now().UTC()
	}
	v := &Vital{
		ID:         newID(),
		UserID:     userID,
		MeasuredAt: when.UTC().Format(time.RFC3339),
		Note:       strings.TrimSpace(in.Note),
	}
	if len(v.Note) > MaxNoteLen {
		v.Note = v.Note[:MaxNoteLen]
	}

	hasWeight := in.WeightKg != nil
	hasBP := in.Systolic != nil || in.Diastolic != nil
	if !hasWeight && !hasBP {
		return nil, fmt.Errorf("%w: a weight or blood-pressure reading is required", ErrInvalid)
	}
	if hasWeight {
		if *in.WeightKg <= 0 || *in.WeightKg > 500 {
			return nil, fmt.Errorf("%w: weight must be between 0 and 500 kg", ErrInvalid)
		}
		v.WeightKg = in.WeightKg
	}
	if hasBP {
		if in.Systolic == nil || in.Diastolic == nil {
			return nil, fmt.Errorf("%w: blood pressure needs both systolic and diastolic", ErrInvalid)
		}
		if *in.Systolic < 40 || *in.Systolic > 300 || *in.Diastolic < 20 || *in.Diastolic > 200 {
			return nil, fmt.Errorf("%w: blood pressure is out of range", ErrInvalid)
		}
		if *in.Systolic <= *in.Diastolic {
			return nil, fmt.Errorf("%w: systolic must be greater than diastolic", ErrInvalid)
		}
		v.Systolic = in.Systolic
		v.Diastolic = in.Diastolic
		if in.Pulse != nil {
			if *in.Pulse < 20 || *in.Pulse > 250 {
				return nil, fmt.Errorf("%w: pulse is out of range", ErrInvalid)
			}
			v.Pulse = in.Pulse
		}
	}

	if err := s.repo.Create(ctx, v); err != nil {
		return nil, err
	}
	return v, nil
}

// List returns a user's measurements newest first, optionally limited to those
// on or after since (a zero time means all of them).
func (s *Service) List(ctx context.Context, userID int64, since time.Time) ([]Vital, error) {
	return s.repo.List(ctx, userID, since)
}

// Delete removes a measurement the user owns.
func (s *Service) Delete(ctx context.Context, userID int64, id string) error {
	return s.repo.Delete(ctx, userID, id)
}

// LatestWeight returns the most recent weight reading, or nil when the user has
// never recorded one.
func (s *Service) LatestWeight(ctx context.Context, userID int64) (*float64, error) {
	return s.repo.LatestWeight(ctx, userID)
}

// PurgeUser removes a user's entire vitals history, for account deletion.
func (s *Service) PurgeUser(ctx context.Context, userID int64) error {
	return s.repo.DeleteAllForUser(ctx, userID)
}
