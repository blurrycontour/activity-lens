package plans

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
var ErrInvalid = errors.New("plans: invalid input")

// ErrSessionRunning is returned when starting a session while one is already
// open. One at a time is not a technical limit: the dashboard shows "resume",
// singular, and a second concurrent session would make "the ongoing one"
// ambiguous everywhere it is referred to.
var ErrSessionRunning = errors.New("plans: a session is already running")

// Limits on structure size. Generous enough that no real plan meets them, low
// enough that one request cannot ask the server to hold an unbounded tree in
// memory or write thousands of rows on a single connection.
const (
	MaxDaysPerPlan       = 30
	MaxBlocksPerDay      = 60
	MaxOptionsPerBlock   = 8
	MaxSetsPerExercise   = 50
	MaxNameLen           = 120
	MaxNoteLen           = 2000
	MaxSessionsPerListed = 200
)

// Service holds training-plan business rules on top of a Repository.
type Service struct {
	repo Repository
}

// NewService builds a plans service.
func NewService(repo Repository) *Service { return &Service{repo: repo} }

// --- Plans ---------------------------------------------------------------

// CreatePlan validates input, persists and returns the plan.
func (s *Service) CreatePlan(ctx context.Context, userID int64, in PlanInput) (*Plan, error) {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, fmt.Errorf("%w: name is required", ErrInvalid)
	}
	if len(name) > MaxNameLen {
		return nil, fmt.Errorf("%w: name is too long", ErrInvalid)
	}
	p := &Plan{
		ID:     newID("pl"),
		UserID: userID,
		Name:   name,
		Notes:  clip(in.Notes, MaxNoteLen),
		Days:   []Day{},
	}
	if err := s.repo.CreatePlan(ctx, p); err != nil {
		return nil, err
	}
	return p, nil
}

// GetPlan returns one plan with its full day structure.
func (s *Service) GetPlan(ctx context.Context, userID int64, id string) (*Plan, error) {
	return s.repo.GetPlan(ctx, userID, id)
}

// ListPlans returns the user's plans, active ones first.
func (s *Service) ListPlans(ctx context.Context, userID int64) ([]Plan, error) {
	return s.repo.ListPlans(ctx, userID)
}

// UpdatePlan applies a partial edit to a plan's own fields.
func (s *Service) UpdatePlan(ctx context.Context, userID int64, id string, p PlanPatch) (*Plan, error) {
	pl, err := s.repo.GetPlan(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		name := strings.TrimSpace(*p.Name)
		if name == "" {
			return nil, fmt.Errorf("%w: name cannot be empty", ErrInvalid)
		}
		pl.Name = clip(name, MaxNameLen)
	}
	if p.Notes != nil {
		pl.Notes = clip(*p.Notes, MaxNoteLen)
	}
	if p.Archived != nil {
		pl.Archived = *p.Archived
	}
	if err := s.repo.UpdatePlan(ctx, pl); err != nil {
		return nil, err
	}
	return pl, nil
}

// DeletePlan removes a plan the user owns. Its days go with it by cascade;
// its finished sessions stay, holding their own snapshots.
func (s *Service) DeletePlan(ctx context.Context, userID int64, id string) error {
	return s.repo.DeletePlan(ctx, userID, id)
}

// ReplaceDays validates and writes a plan's whole day structure, filling in
// ids for anything the client created.
func (s *Service) ReplaceDays(ctx context.Context, userID int64, planID string, days []Day) (*Plan, error) {
	clean, err := normalizeDays(days)
	if err != nil {
		return nil, err
	}
	if err := s.repo.ReplaceDays(ctx, userID, planID, clean); err != nil {
		return nil, err
	}
	return s.repo.GetPlan(ctx, userID, planID)
}

// normalizeDays validates the tree and fills in missing ids.
//
// Empty blocks are dropped rather than rejected: the editor creates a block
// the moment "add exercise" is tapped, and a user who backs out of that should
// not get a validation error for a row they never filled in.
func normalizeDays(days []Day) ([]Day, error) {
	if len(days) > MaxDaysPerPlan {
		return nil, fmt.Errorf("%w: at most %d days per plan", ErrInvalid, MaxDaysPerPlan)
	}
	out := make([]Day, 0, len(days))
	for _, d := range days {
		name := strings.TrimSpace(d.Name)
		if name == "" {
			return nil, fmt.Errorf("%w: every day needs a name", ErrInvalid)
		}
		if len(d.Blocks) > MaxBlocksPerDay {
			return nil, fmt.Errorf("%w: at most %d exercises per day", ErrInvalid, MaxBlocksPerDay)
		}
		day := Day{ID: idOr(d.ID, "pd"), Name: clip(name, MaxNameLen), Blocks: []Block{}}
		for _, b := range d.Blocks {
			if len(b.Options) > MaxOptionsPerBlock {
				return nil, fmt.Errorf("%w: at most %d alternatives per exercise", ErrInvalid, MaxOptionsPerBlock)
			}
			block := Block{ID: idOr(b.ID, "pb"), Options: []Exercise{}, RestSec: min(max(b.RestSec, 0), 3600)}
			for _, e := range b.Options {
				exName := strings.TrimSpace(e.Name)
				if exName == "" {
					continue
				}
				sets := e.Sets
				if sets < 1 {
					sets = 1
				}
				if sets > MaxSetsPerExercise {
					sets = MaxSetsPerExercise
				}
				kind := e.Kind
				if !ValidKind(kind) {
					kind = KindWeight
				}
				block.Options = append(block.Options, Exercise{
					ID:          idOr(e.ID, "pe"),
					Name:        clip(exName, MaxNameLen),
					Kind:        kind,
					Sets:        sets,
					Reps:        clip(strings.TrimSpace(e.Reps), 32),
					DurationSec: min(max(e.DurationSec, 0), 24*3600),
					WeightKg:    max(e.WeightKg, 0),
					RestSec:     min(max(e.RestSec, 0), 3600),
					Note:        clip(e.Note, MaxNoteLen),
				})
			}
			if len(block.Options) == 0 {
				continue
			}
			// Clamped to what the block can actually satisfy: "do 3 of these"
			// means nothing once one of the three has been deleted.
			block.Required = min(max(b.Required, 1), len(block.Options))
			day.Blocks = append(day.Blocks, block)
		}
		out = append(out, day)
	}
	return out, nil
}

// --- Sessions ------------------------------------------------------------

// StartSession opens a session against one day of a plan, snapshotting that
// day as it stands right now.
func (s *Service) StartSession(ctx context.Context, userID int64, planID, dayID string) (*Session, error) {
	if _, err := s.repo.ActiveSession(ctx, userID); err == nil {
		return nil, ErrSessionRunning
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	p, err := s.repo.GetPlan(ctx, userID, planID)
	if err != nil {
		return nil, err
	}
	var day *Day
	for i := range p.Days {
		if p.Days[i].ID == dayID {
			day = &p.Days[i]
			break
		}
	}
	if day == nil {
		return nil, fmt.Errorf("%w: no such day in this plan", ErrInvalid)
	}
	if len(day.Blocks) == 0 {
		return nil, fmt.Errorf("%w: this day has no exercises yet", ErrInvalid)
	}

	sess := &Session{
		ID:        newID("ps"),
		UserID:    userID,
		PlanID:    p.ID,
		PlanName:  p.Name,
		DayName:   day.Name,
		Snapshot:  *day,
		Progress:  Progress{Blocks: map[string]BlockProgress{}},
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}
	_, sess.TotalSets, _ = sess.Stats()
	if err := s.repo.CreateSession(ctx, sess); err != nil {
		return nil, err
	}
	return sess, nil
}

// ActiveSession returns the user's open session, or ErrNotFound.
func (s *Service) ActiveSession(ctx context.Context, userID int64) (*Session, error) {
	return s.repo.ActiveSession(ctx, userID)
}

// GetSession returns one session.
func (s *Service) GetSession(ctx context.Context, userID int64, id string) (*Session, error) {
	return s.repo.GetSession(ctx, userID, id)
}

// ListSessions returns finished and unfinished sessions, newest first.
func (s *Service) ListSessions(ctx context.Context, userID int64, limit, offset int) ([]Session, error) {
	if limit <= 0 || limit > MaxSessionsPerListed {
		limit = 50
	}
	return s.repo.ListSessions(ctx, userID, limit, max(offset, 0))
}

// SaveProgress records what the runner has ticked so far.
//
// The client sends its whole progress map rather than a delta. Ticks are
// idempotent and a session is small, so a lost or duplicated request costs
// nothing — where a delta stream that drops one leaves the two sides disagreed
// with no way to notice.
func (s *Service) SaveProgress(ctx context.Context, userID int64, id string, p Progress) (*Session, error) {
	sess, err := s.repo.GetSession(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if sess.FinishedAt != "" {
		return nil, fmt.Errorf("%w: this session is already finished", ErrInvalid)
	}
	if p.Blocks == nil {
		p.Blocks = map[string]BlockProgress{}
	}
	sess.Progress = p
	sess.DoneSets, sess.TotalSets, sess.VolumeKg = sess.Stats()
	if err := s.repo.UpdateSession(ctx, sess); err != nil {
		return nil, err
	}
	return sess, nil
}

// FinishSession closes a session and returns it with its final totals.
//
// The optional workout is created by the caller, not here: this package knows
// nothing about workouts, and wiring it to the workout service would make the
// two mutually dependent for one field.
func (s *Service) FinishSession(ctx context.Context, userID int64, id, notes string, workoutID string) (*Session, error) {
	sess, err := s.repo.GetSession(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if sess.FinishedAt != "" {
		return nil, fmt.Errorf("%w: this session is already finished", ErrInvalid)
	}
	sess.FinishedAt = time.Now().UTC().Format(time.RFC3339)
	sess.Notes = clip(notes, MaxNoteLen)
	sess.WorkoutID = workoutID
	sess.DoneSets, sess.TotalSets, sess.VolumeKg = sess.Stats()
	if err := s.repo.UpdateSession(ctx, sess); err != nil {
		return nil, err
	}
	return sess, nil
}

// DeleteSession removes a session — used both to discard an abandoned one and
// to delete a record from history.
func (s *Service) DeleteSession(ctx context.Context, userID int64, id string) error {
	return s.repo.DeleteSession(ctx, userID, id)
}

// DeleteSessions removes a batch of history rows the user owns.
func (s *Service) DeleteSessions(ctx context.Context, userID int64, ids []string) (int, error) {
	if len(ids) > MaxSessionsPerListed {
		return 0, fmt.Errorf("%w: at most %d at a time", ErrInvalid, MaxSessionsPerListed)
	}
	clean := make([]string, 0, len(ids))
	seen := map[string]bool{}
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		clean = append(clean, id)
	}
	return s.repo.DeleteSessions(ctx, userID, clean)
}

// MaxExerciseNames caps the suggestion list. Long enough to hold everything a
// real training library uses, short enough that the response stays a few
// kilobytes on a phone.
const MaxExerciseNames = 300

// ExerciseNames returns the names the user has written, for the editor's
// suggestions.
func (s *Service) ExerciseNames(ctx context.Context, userID int64) ([]string, error) {
	return s.repo.ExerciseNames(ctx, userID, MaxExerciseNames)
}

// PurgeUser removes every plan and session a user owns, for account deletion.
func (s *Service) PurgeUser(ctx context.Context, userID int64) error {
	return s.repo.DeleteAllForUser(ctx, userID)
}

// --- helpers -------------------------------------------------------------

func clip(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n]
}

func idOr(id, prefix string) string {
	// Client-supplied ids are kept so an in-progress session still matches its
	// blocks after an edit, but only in the shape this package issues: an id
	// is echoed back into URLs and JSON, and accepting arbitrary text there is
	// how one becomes something else's problem.
	if len(id) > 3 && strings.HasPrefix(id, prefix+"_") && isHex(id[len(prefix)+1:]) {
		return id
	}
	return newID(prefix)
}

func isHex(s string) bool {
	if len(s) == 0 || len(s) > 64 {
		return false
	}
	for _, r := range s {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') {
			return false
		}
	}
	return true
}

func newID(prefix string) string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return prefix + "_" + hex.EncodeToString(b)
}
