package workout

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
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
		Steps:         in.Steps,
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

// Preview derives metrics for the given input without persisting anything. It
// is used to show the numbers a file import would produce before the user
// commits to saving it.
func (s *Service) Preview(in Input) (*Workout, error) {
	if err := validate(&in); err != nil {
		return nil, err
	}
	w := &Workout{
		Name:          strings.TrimSpace(in.Name),
		Type:          in.Type,
		StartTime:     in.StartTime.UTC(),
		Duration:      in.Duration,
		Distance:      in.Distance,
		AvgHR:         in.AvgHR,
		MaxHR:         in.MaxHR,
		ElevationGain: in.ElevationGain,
		Calories:      in.Calories,
		Steps:         in.Steps,
		Route:         in.Route,
		HRTimeline:    in.HRTimeline,
		PaceTimeline:  in.PaceTimeline,
		ElevTimeline:  in.ElevTimeline,
		Notes:         strings.TrimSpace(in.Notes),
	}
	deriveMetrics(w)
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
	if p.Calories != nil {
		if *p.Calories < 0 {
			return nil, fmt.Errorf("%w: calories must be non-negative", ErrInvalid)
		}
		w.Calories = *p.Calories
		w.CaloriesManual = *p.Calories > 0
	}
	if p.Steps != nil {
		if *p.Steps < 0 {
			return nil, fmt.Errorf("%w: steps must be non-negative", ErrInvalid)
		}
		w.Steps = *p.Steps
		w.StepsManual = *p.Steps > 0
	}
	if err := s.repo.Update(ctx, w); err != nil {
		return nil, err
	}
	w.Date = w.StartTime.Format("2006-01-02")
	return w, nil
}

// Recalculate re-derives every computed metric of a workout from its recorded
// route/timelines and the given calorie preferences, overwriting any manually
// entered values. The name, type, date and notes are left untouched.
func (s *Service) Recalculate(ctx context.Context, userID int64, id, calorieMethod string, weightKg float64, age int, sex string) (*Workout, error) {
	w, err := s.repo.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if len(w.HRTimeline) > 0 {
		var sum, count, max int
		for _, p := range w.HRTimeline {
			if p.HR <= 0 {
				continue
			}
			sum += p.HR
			count++
			if p.HR > max {
				max = p.HR
			}
		}
		if count > 0 {
			w.AvgHR = sum / count
			w.MaxHR = max
		}
	}
	if len(w.ElevTimeline) > 0 {
		var gain float64
		for i := 1; i < len(w.ElevTimeline); i++ {
			if d := w.ElevTimeline[i].Elev - w.ElevTimeline[i-1].Elev; d > 0 {
				gain += float64(d)
			}
		}
		w.ElevationGain = gain
	}
	w.AvgPace = 0
	w.AvgSpeed = 0
	w.Steps = estimateSteps(w.Type, w.Distance)
	deriveMetrics(w)
	w.Calories = EstimateCalories(w.Type, w.Duration, w.AvgHR, w.Distance, weightKg, age, sex, calorieMethod)
	// Recalculation re-derives these values, so they are no longer manual.
	w.CaloriesManual = false
	w.StepsManual = false
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
	if w.Steps == 0 {
		w.Steps = estimateSteps(w.Type, w.Distance)
	}
}

// estimateSteps approximates step count from distance using a per-activity
// average stride length. Only foot-based activities produce a value.
func estimateSteps(t Type, distanceMeters float64) int {
	var stride float64
	switch t {
	case TypeRun:
		stride = 1.0
	case TypeHike:
		stride = 0.75
	default:
		return 0
	}
	if distanceMeters <= 0 {
		return 0
	}
	return int(math.Round(distanceMeters / stride))
}

// EstimateCalories returns an energy-expenditure estimate (kcal) using a
// heart-rate formula when average HR is available, otherwise a distance-based
// approximation. Returns 0 when there is not enough data.
func EstimateCalories(t Type, duration, avgHR int, distanceMeters, weightKg float64, age int, sex, method string) int {
	if duration <= 0 || weightKg <= 0 {
		return 0
	}
	if method == "heart-rate" && avgHR > 0 {
		// Keytel et al. (2005) HR-based energy-expenditure formula (kcal/min),
		// selecting the sex-specific coefficients. Age defaults to 35 when the
		// user hasn't provided a birth year.
		if age <= 0 {
			age = 35
		}
		var kcalPerMin float64
		if sex == "female" {
			kcalPerMin = (-20.4022 + 0.4472*float64(avgHR) - 0.1263*weightKg + 0.074*float64(age)) / 4.184
		} else {
			kcalPerMin = (-55.0969 + 0.6309*float64(avgHR) + 0.1988*weightKg + 0.2017*float64(age)) / 4.184
		}
		if kcalPerMin < 0 {
			kcalPerMin = 0
		}
		return int(math.Round(kcalPerMin * float64(duration) / 60))
	}
	if distanceMeters <= 0 {
		return 0
	}
	factor := 1.0
	if t == TypeRide {
		factor = 0.35
	}
	return int(math.Round(factor * weightKg * distanceMeters / 1000))
}

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return "w_" + hex.EncodeToString(b)
}
