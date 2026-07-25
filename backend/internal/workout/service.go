package workout

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// ErrInvalid is returned for validation failures on caller-supplied input.
var ErrInvalid = errors.New("workout: invalid input")

// Service holds workout business rules on top of a Repository.
type Service struct {
	repo Repository
}

// NewService builds a workout service.
func NewService(repo Repository) *Service { return &Service{repo: repo} }

// Create validates input, derives metrics, persists and returns the workout.
func (s *Service) Create(ctx context.Context, userID int64, in Input) (*Workout, error) {
	if err := validate(&in); err != nil {
		return nil, err
	}
	w := &Workout{
		ID:            newID(),
		UserID:        userID,
		Name:          strings.TrimSpace(in.Name),
		Type:          in.Type,
		StartTime:     in.StartTime.UTC(),
		Duration:      in.Duration,
		Distance:      in.Distance,
		AvgHR:         in.AvgHR,
		MaxHR:         in.MaxHR,
		ElevationGain: in.ElevationGain,
		Calories:      in.Calories,
		Route:         in.Route,
		HRTimeline:    in.HRTimeline,
		PaceTimeline:  in.PaceTimeline,
		ElevTimeline:  in.ElevTimeline,
		Notes:         strings.TrimSpace(in.Notes),
	}
	deriveMetrics(w)
	if err := s.repo.Create(ctx, w); err != nil {
		return nil, err
	}
	w.Date = w.StartTime.Format("2006-01-02")
	return w, nil
}

// Get returns a single workout owned by the user.
func (s *Service) Get(ctx context.Context, userID int64, id string) (*Workout, error) {
	return s.repo.Get(ctx, userID, id)
}

// List returns all of the user's workouts, newest first.
func (s *Service) List(ctx context.Context, userID int64) ([]Workout, error) {
	return s.repo.List(ctx, userID)
}

// ListSummary returns all of the user's workouts, newest first, without the
// route/HR/pace/elevation timelines. Use this for list/overview views that
// only render scalar fields (dashboard cards, the workouts list, heatmap).
func (s *Service) ListSummary(ctx context.Context, userID int64) ([]Workout, error) {
	return s.repo.ListSummary(ctx, userID)
}

// Update applies a partial edit to a workout the user owns.
func (s *Service) Update(ctx context.Context, userID int64, id string, p Patch) (*Workout, error) {
	w, err := s.repo.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		name := strings.TrimSpace(*p.Name)
		if name == "" {
			return nil, fmt.Errorf("%w: name cannot be empty", ErrInvalid)
		}
		w.Name = name
	}
	if p.Type != nil {
		if !ValidType(*p.Type) {
			return nil, fmt.Errorf("%w: unknown type %q", ErrInvalid, *p.Type)
		}
		w.Type = *p.Type
	}
	if p.Notes != nil {
		w.Notes = strings.TrimSpace(*p.Notes)
	}
	if p.StartTime != nil {
		w.StartTime = p.StartTime.UTC()
	}
	if err := s.repo.Update(ctx, w); err != nil {
		return nil, err
	}
	w.Date = w.StartTime.Format("2006-01-02")
	return w, nil
}

// Delete removes a workout the user owns.
func (s *Service) Delete(ctx context.Context, userID int64, id string) error {
	return s.repo.Delete(ctx, userID, id)
}

// Stats computes aggregate statistics over the user's whole library.
func (s *Service) Stats(ctx context.Context, userID int64) (*Stats, error) {
	list, err := s.repo.ListSummary(ctx, userID)
	if err != nil {
		return nil, err
	}
	st := &Stats{TypeCounts: map[Type]int{}}
	now := time.Now().UTC()
	cutoff30 := now.AddDate(0, 0, -30)
	var hrSum, hrCount int
	for i := range list {
		w := &list[i]
		st.Count++
		st.TotalDistance += w.Distance
		st.TotalDuration += w.Duration
		st.TotalElevation += w.ElevationGain
		st.TotalCalories += w.Calories
		st.TypeCounts[w.Type]++
		if w.AvgHR > 0 {
			hrSum += w.AvgHR
			hrCount++
		}
		if w.StartTime.After(cutoff30) {
			st.Last30Count++
		}
	}
	if hrCount > 0 {
		st.AvgHR = hrSum / hrCount
	}
	st.Weekly = weeklyBuckets(list, now)
	return st, nil
}

// weeklyBuckets returns the last 8 weeks of volume, oldest first.
func weeklyBuckets(list []Workout, now time.Time) []WeeklyBucket {
	buckets := make([]WeeklyBucket, 8)
	for i := 0; i < 8; i++ {
		weekEnd := now.AddDate(0, 0, -((7 - i) * 7))
		weekStart := weekEnd.AddDate(0, 0, -6)
		var dur int
		var dist float64
		var count int
		for j := range list {
			t := list[j].StartTime
			if !t.Before(startOfDay(weekStart)) && !t.After(endOfDay(weekEnd)) {
				dur += list[j].Duration
				dist += list[j].Distance
				count++
			}
		}
		buckets[i] = WeeklyBucket{
			Week:     fmt.Sprintf("W%d", i+1),
			Hours:    float64(dur) / 3600,
			Count:    count,
			Distance: dist,
		}
	}
	return buckets
}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func endOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, t.Location())
}

func validate(in *Input) error {
	if strings.TrimSpace(in.Name) == "" {
		return fmt.Errorf("%w: name is required", ErrInvalid)
	}
	if !ValidType(in.Type) {
		return fmt.Errorf("%w: unknown type %q", ErrInvalid, in.Type)
	}
	if in.StartTime.IsZero() {
		in.StartTime = time.Now().UTC()
	}
	if in.Duration < 0 || in.Distance < 0 {
		return fmt.Errorf("%w: duration and distance must be non-negative", ErrInvalid)
	}
	return nil
}

// deriveMetrics fills in avg pace/speed from distance & duration when possible,
// and sorts route/timeline samples so downstream charts render correctly.
func deriveMetrics(w *Workout) {
	if w.Distance > 0 && w.Duration > 0 {
		km := w.Distance / 1000
		hours := float64(w.Duration) / 3600
		w.AvgSpeed = km / hours
		if w.Type == TypeRun || w.Type == TypeHike {
			w.AvgPace = float64(w.Duration) / km // seconds per km
		}
	}
	sort.Slice(w.HRTimeline, func(i, j int) bool { return w.HRTimeline[i].T < w.HRTimeline[j].T })
	sort.Slice(w.PaceTimeline, func(i, j int) bool { return w.PaceTimeline[i].T < w.PaceTimeline[j].T })
	sort.Slice(w.ElevTimeline, func(i, j int) bool { return w.ElevTimeline[i].T < w.ElevTimeline[j].T })
}

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "w_" + hex.EncodeToString(b)
}
