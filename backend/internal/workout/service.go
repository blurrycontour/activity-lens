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
// It always inserts; callers importing from a file or a sync source should use
// CreateIdempotent so a repeat import does not duplicate.
func (s *Service) Create(ctx context.Context, userID int64, in Input) (*Workout, error) {
	if err := validate(&in); err != nil {
		return nil, err
	}
	w := &Workout{
		ID:               newID(),
		UserID:           userID,
		Name:             strings.TrimSpace(in.Name),
		Type:             in.Type,
		StartTime:        in.StartTime.UTC(),
		Duration:         in.Duration,
		Distance:         in.Distance,
		AvgHR:            in.AvgHR,
		MaxHR:            in.MaxHR,
		ElevationGain:    in.ElevationGain,
		Calories:         in.Calories,
		Steps:            in.Steps,
		Route:            in.Route,
		HRTimeline:       in.HRTimeline,
		PaceTimeline:     in.PaceTimeline,
		ElevTimeline:     in.ElevTimeline,
		Notes:            strings.TrimSpace(in.Notes),
		CaloriesReported: in.CaloriesReported,
		CadenceTimeline:  in.CadenceTimeline,
		Source:           in.Source,
		ExternalID:       in.ExternalID,
		ContentHash:      in.ContentHash,
	}
	deriveMetrics(w, in.StepLengthM)
	if err := s.repo.Create(ctx, w); err != nil {
		return nil, err
	}
	w.Date = w.StartTime.Format("2006-01-02")
	return w, nil
}

// CreateIdempotent persists a workout unless one with the same
// (source, external id) identity already exists for the user, in which case the
// existing workout is returned untouched. created reports which happened.
//
// An input with no ExternalID cannot be de-duplicated and is always inserted.
func (s *Service) CreateIdempotent(ctx context.Context, userID int64, in Input) (w *Workout, created bool, err error) {
	if in.Source == "" {
		in.Source = SourceManual
	}
	if in.ExternalID == "" {
		w, err = s.Create(ctx, userID, in)
		return w, err == nil, err
	}
	if existing, err := s.repo.GetByExternalID(ctx, userID, in.Source, in.ExternalID); err == nil {
		return existing, false, nil
	} else if !errors.Is(err, ErrNotFound) {
		return nil, false, err
	}
	w, err = s.Create(ctx, userID, in)
	// Lost a race against a concurrent import of the same workout: the unique
	// index rejected the insert, so return whatever won.
	if errors.Is(err, ErrDuplicate) {
		existing, getErr := s.repo.GetByExternalID(ctx, userID, in.Source, in.ExternalID)
		if getErr != nil {
			return nil, false, err
		}
		return existing, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return w, true, nil
}

// Preview derives metrics for the given input without persisting anything. It
// is used to show the numbers a file import would produce before the user
// commits to saving it.
func (s *Service) Preview(in Input) (*Workout, error) {
	if err := validate(&in); err != nil {
		return nil, err
	}
	w := &Workout{
		Name:             strings.TrimSpace(in.Name),
		Type:             in.Type,
		StartTime:        in.StartTime.UTC(),
		Duration:         in.Duration,
		Distance:         in.Distance,
		AvgHR:            in.AvgHR,
		MaxHR:            in.MaxHR,
		ElevationGain:    in.ElevationGain,
		Calories:         in.Calories,
		Steps:            in.Steps,
		Route:            in.Route,
		HRTimeline:       in.HRTimeline,
		PaceTimeline:     in.PaceTimeline,
		ElevTimeline:     in.ElevTimeline,
		Notes:            strings.TrimSpace(in.Notes),
		CaloriesReported: in.CaloriesReported,
		CadenceTimeline:  in.CadenceTimeline,
	}
	deriveMetrics(w, in.StepLengthM)
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
		// A hand-entered value supersedes whatever the source file said.
		w.CaloriesReported = w.CaloriesReported && !w.CaloriesManual
	}
	if p.Steps != nil {
		if *p.Steps < 0 {
			return nil, fmt.Errorf("%w: steps must be non-negative", ErrInvalid)
		}
		w.Steps = *p.Steps
		w.StepsManual = *p.Steps > 0
	}
	// Distance is applied last, because pace, speed and the step estimate are
	// all computed from it and must not be left describing the old figure. A
	// workout whose distance says 5 km and whose pace still says 4:00 from the
	// 8 km it used to be is worse than one with no distance at all.
	if p.Distance != nil {
		if *p.Distance < 0 {
			return nil, fmt.Errorf("%w: distance must be non-negative", ErrInvalid)
		}
		if *p.Distance > maxDistanceMeters {
			return nil, fmt.Errorf("%w: distance is implausibly large", ErrInvalid)
		}
		w.Distance = *p.Distance
		derivePaceSpeed(w)
		// A count the user typed in is theirs and stays; anything else was
		// derived from the distance that just changed.
		if !w.StepsManual {
			deriveSteps(w, p.StepLengthM)
		}
	}
	if err := s.repo.Update(ctx, w); err != nil {
		return nil, err
	}
	w.Date = w.StartTime.Format("2006-01-02")
	return w, nil
}

// RecalcParts selects which derived values a recalculation replaces.
//
// Selective because recalculation is destructive in a way the user cannot
// undo: it overwrites hand-entered calories and steps, and someone who wants
// their pauses found on an old workout should not have to lose a corrected
// calorie figure to get them. An empty struct is a no-op rather than an
// everything, so a request that names nothing changes nothing.
type RecalcParts struct {
	HeartRate bool
	Elevation bool
	// Pauses covers the moving time as well; the two are one calculation.
	Pauses bool
	// PaceSpeed is computed from the stored moving time, so recalculating it
	// without Pauses uses whatever moving time the workout already has.
	PaceSpeed bool
	Steps     bool
	Calories  bool
}

// AllRecalcParts is every part, which is what a request that names none gets —
// the behaviour before this was selectable.
func AllRecalcParts() RecalcParts {
	return RecalcParts{HeartRate: true, Elevation: true, Pauses: true, PaceSpeed: true, Steps: true, Calories: true}
}

// Any reports whether there is anything to do.
func (p RecalcParts) Any() bool {
	return p.HeartRate || p.Elevation || p.Pauses || p.PaceSpeed || p.Steps || p.Calories
}

// CalorieProfile is the body data the calorie estimate needs, gathered into one
// argument so Recalculate does not take eight.
type CalorieProfile struct {
	Method      string
	WeightKg    float64
	Age         int
	Sex         string
	StepLengthM float64
}

// Recalculate re-derives the selected metrics of a workout from its recorded
// route and timelines, overwriting any manually entered values among them. The
// name, type, date and notes are never touched, and neither is the weather.
func (s *Service) Recalculate(ctx context.Context, userID int64, id string, parts RecalcParts, profile CalorieProfile) (*Workout, error) {
	w, err := s.repo.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if !parts.Any() {
		return nil, fmt.Errorf("%w: nothing selected to recalculate", ErrInvalid)
	}
	// Always, and not a part: the series are stored in whatever order they were
	// written, and everything below reads them in order. It changes no value.
	sortTimelines(w)

	if parts.HeartRate && len(w.HRTimeline) > 0 {
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
	if parts.Elevation && len(w.ElevTimeline) > 0 {
		var gain float64
		for i := 1; i < len(w.ElevTimeline); i++ {
			if d := w.ElevTimeline[i].Elev - w.ElevTimeline[i-1].Elev; d > 0 {
				gain += float64(d)
			}
		}
		w.ElevationGain = gain
	}
	if parts.Pauses {
		derivePauses(w)
	}
	if parts.PaceSpeed {
		derivePaceSpeed(w)
	}
	if parts.Steps {
		deriveSteps(w, profile.StepLengthM)
		w.StepsManual = false
	}
	if parts.Calories {
		w.Calories = EstimateCalories(w.Type, w.Duration, w.AvgHR, w.Distance, profile.WeightKg, profile.Age, profile.Sex, profile.Method)
		// Re-derived, so neither hand-entered nor the number the file reported.
		w.CaloriesManual = false
		w.CaloriesReported = false
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

// sortTimelines puts every per-sample series in time order, which everything
// downstream assumes: the charts draw them in array order, and a pause is a gap
// between consecutive samples, so an unsorted series is nothing but gaps.
func sortTimelines(w *Workout) {
	sort.Slice(w.HRTimeline, func(i, j int) bool { return w.HRTimeline[i].T < w.HRTimeline[j].T })
	sort.Slice(w.PaceTimeline, func(i, j int) bool { return w.PaceTimeline[i].T < w.PaceTimeline[j].T })
	sort.Slice(w.ElevTimeline, func(i, j int) bool { return w.ElevTimeline[i].T < w.ElevTimeline[j].T })
	sort.Slice(w.CadenceTimeline, func(i, j int) bool { return w.CadenceTimeline[i].T < w.CadenceTimeline[j].T })
}

// derivePauses finds the gaps in the recording and the moving time they leave.
// Runs on sorted series only.
func derivePauses(w *Workout) {
	w.Pauses = DetectPauses(w)
	w.MovingTime = MovingSeconds(w.Duration, w.Pauses)
}

// derivePaceSpeed computes the headline rates over moving time.
//
// Moving time, not elapsed. A run with five minutes standing at a level
// crossing did not slow down; averaging over the wait says it did, and says so
// in the figure the whole library is ranked by.
func derivePaceSpeed(w *Workout) {
	w.AvgPace = 0
	w.AvgSpeed = 0
	if w.Distance <= 0 || w.MovingTime <= 0 {
		return
	}
	km := w.Distance / 1000
	w.AvgSpeed = km / (float64(w.MovingTime) / 3600)
	if onFoot(w.Type) {
		w.AvgPace = float64(w.MovingTime) / km // seconds per km
	}
}

// deriveSteps fills in a step count, preferring the recorded cadence.
func deriveSteps(w *Workout, stepLengthM float64) {
	if steps, ok := stepsFromCadence(w); ok {
		w.Steps = steps
		return
	}
	w.Steps = estimateSteps(w.Type, w.Distance, stepLengthM)
}

// deriveMetrics fills in the values that follow from the recorded series, and
// sorts those series so downstream charts render correctly.
func deriveMetrics(w *Workout, stepLengthM float64) {
	sortTimelines(w)
	// Before the averages, because they are computed from what it produces.
	derivePauses(w)
	derivePaceSpeed(w)
	if w.Steps == 0 {
		deriveSteps(w, stepLengthM)
	}
}

// The longest gap in the cadence series that is still integrated across.
//
// Cadence is a rate, so turning it into a count means multiplying by the time
// each sample stands for — and across a five-minute pause that invents five
// minutes of walking. Anything longer than this is treated as time the device
// was not measuring, and contributes nothing.
const maxCadenceGapSec = 30

// stepsFromCadence integrates the cadence series into a step count.
//
// Preferred over the stride estimate wherever it exists, because it is very
// nearly a measurement: the watch counted the steps and reported the rate,
// where the estimate divides distance by an assumed stride and is wrong by
// however much the person's stride differs from the assumption — which on a
// hill, or on a walk, is a lot.
//
// The series is already normalised to total steps per minute at import; see
// normalizeCadence, which doubles the per-foot figure some devices report.
func stepsFromCadence(w *Workout) (int, bool) {
	if !onFoot(w.Type) || len(w.CadenceTimeline) < 2 {
		return 0, false
	}
	var total float64
	for i := 1; i < len(w.CadenceTimeline); i++ {
		dt := w.CadenceTimeline[i].T - w.CadenceTimeline[i-1].T
		if dt <= 0 || dt > maxCadenceGapSec {
			continue
		}
		// Trapezoid: the rate between two samples is taken as the average of
		// them, which is closer than either endpoint over a changing cadence.
		mean := float64(w.CadenceTimeline[i].Cad+w.CadenceTimeline[i-1].Cad) / 2
		total += mean * float64(dt) / 60
	}
	if total <= 0 {
		return 0, false
	}
	return int(math.Round(total)), true
}

// The longest distance a single workout can plausibly claim. Generous enough
// for an ultra or a long ride, and low enough that a units mix-up — kilometres
// typed where metres were wanted — is caught rather than stored.
const maxDistanceMeters = 1000 * 1000

// onFoot reports whether pace and a step count mean anything for this activity.
//
// TypeOther is included deliberately. It is not a sport someone picks — it is
// where an import lands when the file named no sport and its free text named
// none — and in practice that is a walk, a hike or a treadmill session from a
// device that writes "Other" into the field. Rides are the case pace is
// withheld from, and a ride is never misfiled here: a file that knows enough to
// record cycling says so.
//
// The cost of being wrong is a step estimate on a row or a paddle. That is the
// same class of estimate the app already makes for a hike, and it is visible
// and correctable, where withholding both figures from every unclassified
// workout was neither.
func onFoot(t Type) bool {
	return t == TypeRun || t == TypeHike || t == TypeOther
}

// estimateSteps approximates step count from distance using the user's stride
// length when provided (stepLengthM > 0), otherwise a per-activity average.
// Only foot-based activities produce a value.
func estimateSteps(t Type, distanceMeters, stepLengthM float64) int {
	var stride float64
	switch t {
	case TypeRun:
		stride = 1.0
	case TypeHike, TypeOther:
		// The walking figure for both: an unclassified activity is far more
		// likely to be walked than run, and under-counting steps is the kinder
		// error of the two.
		stride = 0.75
	default:
		return 0
	}
	if stepLengthM > 0 {
		stride = stepLengthM
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

// ── Gallery ───────────────────────────────────────────────────────────────
//
// Thin pass-throughs. The permission decision belongs to the handler, which is
// the only layer that knows whether this request is a read by a viewer or a
// write by the owner — and putting a half-check here would invite the handler
// to skip its own.

// Photos returns a workout's gallery in display order.
func (s *Service) Photos(ctx context.Context, workoutID string) ([]Media, error) {
	return s.repo.ListMedia(ctx, workoutID)
}

// Photo returns one gallery entry, scoped to its workout.
func (s *Service) Photo(ctx context.Context, workoutID, mediaID string) (Media, error) {
	return s.repo.GetMedia(ctx, workoutID, mediaID)
}

// PhotoCount is how the upload path enforces MaxMediaPerWorkout.
func (s *Service) PhotoCount(ctx context.Context, workoutID string) (int, error) {
	return s.repo.CountMedia(ctx, workoutID)
}

// AddPhoto records an already-stored photo.
//
// The id normally arrives already set, from NewPhotoID: the file on disk is
// named after it, so it has to exist before the bytes are written. Generating
// one here covers a caller that has no file to name.
func (s *Service) AddPhoto(ctx context.Context, m Media) (Media, error) {
	if m.ID == "" {
		id, err := newMediaID()
		if err != nil {
			return Media{}, err
		}
		m.ID = id
	}
	if m.CreatedAt.IsZero() {
		m.CreatedAt = time.Now().UTC()
	}
	if m.Kind == "" {
		m.Kind = "photo"
	}
	if err := s.repo.AddMedia(ctx, m); err != nil {
		return Media{}, err
	}
	return m, nil
}

// RemovePhoto deletes a gallery entry's row.
func (s *Service) RemovePhoto(ctx context.Context, workoutID, mediaID string) error {
	return s.repo.DeleteMedia(ctx, workoutID, mediaID)
}

// PurgeUserPhotos removes every gallery row a user added, for account deletion.
func (s *Service) PurgeUserPhotos(ctx context.Context, userID int64) error {
	return s.repo.DeleteMediaForUser(ctx, userID)
}

// NewPhotoID hands out an id before the bytes are written, so the file can be
// named after the row it is about to have.
func (s *Service) NewPhotoID() (string, error) { return newMediaID() }
