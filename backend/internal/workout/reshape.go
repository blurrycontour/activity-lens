package workout

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"
)

// Stream names a recorded series a workout can be stripped of.
//
// Only the series that are genuinely optional and genuinely go wrong: a
// treadmill run whose cadence is nonsense, a chest strap that dropped out, a
// barometer that drifted indoors. Duration and distance are not here — a
// workout without them is not a workout.
type Stream string

const (
	StreamHeartRate Stream = "hr"
	StreamCadence   Stream = "cadence"
	StreamElevation Stream = "elevation"
	StreamPace      Stream = "pace"
	StreamRoute     Stream = "route"
)

/*
StreamExtraPrefix names one of the workout's own extra series.

"extra:power" rather than "power", because that half of the set is open: it is
whatever the file happened to record, and a bare name would put an unbounded
namespace next to five fixed ones with nothing to tell them apart. The prefix
means a future series called "pace" cannot collide with the real one.
*/
const StreamExtraPrefix = "extra:"

// ExtraStream names the extra series called name.
func ExtraStream(name string) Stream { return Stream(StreamExtraPrefix + name) }

// ExtraStreamName returns the series an extra stream refers to, if it is one.
func ExtraStreamName(s Stream) (string, bool) {
	name, ok := strings.CutPrefix(string(s), StreamExtraPrefix)
	return name, ok && name != ""
}

// ValidStream reports whether s names a series that can be dropped.
//
// An extra stream is accepted by shape rather than by membership: which ones a
// workout has is the workout's business, and dropping one it does not have is a
// no-op rather than an error — the same as dropping a heart rate it never had.
func ValidStream(s Stream) bool {
	switch s {
	case StreamHeartRate, StreamCadence, StreamElevation, StreamPace, StreamRoute:
		return true
	}
	_, ok := ExtraStreamName(s)
	return ok
}

// Reshape is an edit to what a workout actually recorded, as opposed to what it
// is called: keep this stretch of it, and throw these series away.
//
// One operation rather than two, because they are one edit as far as the reader
// is concerned — "tidy this workout up" — and doing them separately would mean
// recomputing every derived number twice and confirming twice.
type Reshape struct {
	// Start and End bound the stretch to keep, in seconds from the original
	// start. End of 0 means "to the end", which is what an untouched right-hand
	// handle sends.
	Start int
	End   int
	// Drop names series to discard entirely.
	Drop []Stream
}

// Trims reports whether the window actually removes anything.
func (r Reshape) Trims(duration int) bool {
	return r.Start > 0 || (r.End > 0 && r.End < duration)
}

// Any reports whether this reshape would change the workout at all.
func (r Reshape) Any(duration int) bool {
	return r.Trims(duration) || len(r.Drop) > 0
}

// Validate checks the window against the workout it will be applied to.
//
// The floor is deliberate: a workout trimmed to nothing is not an edit, it is a
// deletion by another name, and every derived number below divides by the
// duration.
func (r Reshape) Validate(duration int) error {
	if r.Start < 0 || r.End < 0 {
		return fmt.Errorf("%w: a trim cannot start or end before the workout does", ErrInvalid)
	}
	end := r.End
	if end == 0 || end > duration {
		end = duration
	}
	if end-r.Start < MinTrimSeconds {
		return fmt.Errorf("%w: keep at least %d seconds", ErrInvalid, MinTrimSeconds)
	}
	for _, s := range r.Drop {
		if !ValidStream(s) {
			return fmt.Errorf("%w: unknown data series %q", ErrInvalid, s)
		}
	}
	return nil
}

// MinTrimSeconds is the shortest a trimmed workout may be.
const MinTrimSeconds = 10

// applyReshape rewrites w in place, and reports whether anything changed.
//
// Pure: no clock, no database, no user. Every interesting case here — a window
// that keeps nothing, a route that cannot be timed, a workout with no series at
// all — is a wrong number rather than an error, so this is the part worth
// testing directly.
func applyReshape(w *Workout, r Reshape) bool {
	sortTimelines(w)
	changed := false

	if r.Trims(w.Duration) {
		end := r.End
		if end == 0 || end > w.Duration {
			end = w.Duration
		}
		trimWorkout(w, r.Start, end)
		changed = true
	}

	for _, s := range r.Drop {
		switch s {
		case StreamHeartRate:
			// The averages go with it. Leaving them behind is the worst of both
			// outcomes: a workout that shows an average heart rate and has no
			// heart rate to show you.
			w.HRTimeline = nil
			w.AvgHR, w.MaxHR = 0, 0
		case StreamCadence:
			w.CadenceTimeline = nil
		case StreamElevation:
			w.ElevTimeline = nil
			w.ElevationGain = 0
		case StreamPace:
			w.PaceTimeline = nil
		case StreamRoute:
			// Distance stays: it is still how far you went, and it is the one
			// number a dropped route cannot re-derive.
			w.Route = nil
		default:
			if name, ok := ExtraStreamName(s); ok {
				delete(w.ExtraSeries, name)
			}
		}
		changed = true
	}
	return changed
}

// trimWorkout keeps [start, end] seconds and rebases everything onto the new
// start.
func trimWorkout(w *Workout, start, end int) {
	kept := end - start
	// The route first, while the old duration still explains its timing.
	routeTimes := routeTimeline(w)
	route := make([]LatLng, 0, len(w.Route))
	for i, p := range w.Route {
		if t := routeTimes[i]; t >= start && t <= end {
			route = append(route, p)
		}
	}

	w.HRTimeline = trimSeries(w.HRTimeline, start, end, func(p *HRPoint, t int) { p.T = t }, func(p HRPoint) int { return p.T })
	w.PaceTimeline = trimSeries(w.PaceTimeline, start, end, func(p *PacePoint, t int) { p.T = t }, func(p PacePoint) int { return p.T })
	w.ElevTimeline = trimSeries(w.ElevTimeline, start, end, func(p *ElevPoint, t int) { p.T = t }, func(p ElevPoint) int { return p.T })
	w.CadenceTimeline = trimSeries(w.CadenceTimeline, start, end, func(p *CadencePoint, t int) { p.T = t }, func(p CadencePoint) int { return p.T })
	// The named series are trimmed with everything else. They are recorded
	// samples on the same clock, so a window that rebased the charted four and
	// left these on the original one would draw power against the wrong
	// seconds — and it would look like the trim had worked.
	for name, series := range w.ExtraSeries {
		kept := trimSeries(series, start, end, func(p *ExtraPoint, t int) { p.T = t }, func(p ExtraPoint) int { return p.T })
		if len(kept) == 0 {
			delete(w.ExtraSeries, name)
			continue
		}
		w.ExtraSeries[name] = kept
	}

	// Pauses are clipped to the window rather than dropped: a pause that
	// straddles the new start is still a pause, just a shorter one.
	pauses := make([]Pause, 0, len(w.Pauses))
	for _, p := range w.Pauses {
		from, to := max(p.From, start), min(p.To, end)
		if to > from {
			pauses = append(pauses, Pause{From: from - start, To: to - start})
		}
	}
	w.Pauses = pauses

	// Distance from what is left of the route, which is the only measured
	// answer. Without a route — a treadmill, a manual entry — the best
	// available answer is the same pace over less time, so it scales.
	if len(route) >= 2 {
		var d float64
		for i := 1; i < len(route); i++ {
			d += metresBetween(route[i-1], route[i])
		}
		w.Distance = d
	} else if w.Duration > 0 {
		w.Distance = w.Distance * float64(kept) / float64(w.Duration)
	}
	w.Route = route

	w.StartTime = w.StartTime.Add(time.Duration(start) * time.Second)
	w.Duration = kept
	// Cleared rather than scaled: it is re-derived from the pauses below, and a
	// stale moving time is what every pace on the page would be computed from.
	w.MovingTime = 0
}

// trimSeries keeps the samples inside the window and rebases their timestamps.
func trimSeries[T any](in []T, start, end int, setT func(*T, int), getT func(T) int) []T {
	if in == nil {
		return nil
	}
	out := make([]T, 0, len(in))
	for _, p := range in {
		t := getT(p)
		if t < start || t > end {
			continue
		}
		setT(&p, t-start)
		out = append(out, p)
	}
	return out
}

// routeTimeline guesses when each route point was recorded.
//
// The route is stored as bare coordinates — the importer appends a point for
// every fix that has one, and the timestamp goes into the other series — so
// trimming by time needs the mapping back.
//
// Preferred is a series of the same length, which is what a normal file
// produces: every fix carries elevation, or heart rate, so index i of that
// series is index i of the route and its T is the answer. Failing that the
// points are spread evenly across the duration, which is right for a steady
// recording and approximate around pauses. Approximate is acceptable here and
// nowhere else in this file: it decides which coordinates survive a trim by a
// second or two at the edges, not what any number says.
func routeTimeline(w *Workout) []int {
	n := len(w.Route)
	times := make([]int, n)
	if n == 0 {
		return times
	}
	if len(w.ElevTimeline) == n {
		for i, p := range w.ElevTimeline {
			times[i] = p.T
		}
		return times
	}
	if len(w.HRTimeline) == n {
		for i, p := range w.HRTimeline {
			times[i] = p.T
		}
		return times
	}
	if n == 1 {
		return times
	}
	for i := range times {
		times[i] = int(math.Round(float64(i) * float64(w.Duration) / float64(n-1)))
	}
	return times
}

// metresBetween is the great-circle distance between two fixes.
//
// A second copy of the importer's haversine, deliberately: the importer's is
// unexported in another package, and exporting it to share fifteen lines would
// tie the two together for no benefit. If they ever disagree the trim is wrong
// by metres over a kilometre, which the test pins.
func metresBetween(a, b LatLng) float64 {
	const earthRadius = 6371000.0
	lat1 := a[0] * math.Pi / 180
	lat2 := b[0] * math.Pi / 180
	dLat := (b[0] - a[0]) * math.Pi / 180
	dLon := (b[1] - a[1]) * math.Pi / 180
	h := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1)*math.Cos(lat2)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * earthRadius * math.Asin(math.Min(1, math.Sqrt(h)))
}

// Reshape trims a workout to a window, drops the series named, and re-derives
// every number that depended on them.
//
// The workout keeps its identity: same id, same name and notes, same shares,
// equipment, comments and photos. Only what it recorded changes — which is why
// this is not "delete and re-import", the other way to get the same numbers.
//
// The archived original is deliberately untouched, so Restore can put all of
// this back. That is the whole safety net: without it this would be the one
// operation in the app that destroys recorded data with no way back.
func (s *Service) Reshape(ctx context.Context, userID int64, id string, r Reshape, profile CalorieProfile) (*Workout, error) {
	w, err := s.repo.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	if err := r.Validate(w.Duration); err != nil {
		return nil, err
	}
	if !r.Any(w.Duration) {
		return nil, fmt.Errorf("%w: nothing to change", ErrInvalid)
	}
	if !applyReshape(w, r) {
		return nil, fmt.Errorf("%w: nothing to change", ErrInvalid)
	}
	// Everything, because everything downstream of the series is now stale: a
	// shorter workout has a different moving time, pace, step count and calorie
	// estimate, and a dropped series has none of what it fed.
	recalcInto(w, AllRecalcParts(), profile)
	if err := s.repo.Update(ctx, w); err != nil {
		return nil, err
	}
	// The simplified track lives in its own columns, which Update does not
	// write. Without this the overview map would draw the route the workout no
	// longer has, and a dropped route would still answer "has GPS".
	if err := s.repo.SetTrack(ctx, w.ID, w.Route); err != nil {
		return nil, err
	}
	w.Date = w.StartTime.Format("2006-01-02")
	return w, nil
}

// Restore rebuilds a workout's recorded data from the file it was imported
// from, undoing every trim and removal in one step.
//
// What it restores is exactly what the file says: the series, the start time,
// the duration and the numbers derived from them. What it leaves alone is
// everything a person put there since — the name, the notes, the sport, the
// sharing, the equipment. Re-importing the file as a new workout would restore
// the first set and lose the second, which is why this exists at all.
func (s *Service) Restore(ctx context.Context, userID int64, id string, in Input, profile CalorieProfile) (*Workout, error) {
	w, err := s.repo.Get(ctx, userID, id)
	if err != nil {
		return nil, err
	}
	w.StartTime = in.StartTime
	w.Duration = in.Duration
	w.Distance = in.Distance
	w.Route = in.Route
	w.HRTimeline = in.HRTimeline
	w.PaceTimeline = in.PaceTimeline
	w.ElevTimeline = in.ElevTimeline
	w.CadenceTimeline = in.CadenceTimeline
	w.ExtraSeries = in.ExtraSeries
	w.AvgHR, w.MaxHR = in.AvgHR, in.MaxHR
	w.ElevationGain = in.ElevationGain
	// Cleared so the derivations below rebuild them from the restored series
	// rather than keeping figures that describe the trimmed version.
	w.MovingTime = 0
	w.Pauses = nil
	recalcInto(w, AllRecalcParts(), profile)
	if err := s.repo.Update(ctx, w); err != nil {
		return nil, err
	}
	if err := s.repo.SetTrack(ctx, w.ID, w.Route); err != nil {
		return nil, err
	}
	w.Date = w.StartTime.Format("2006-01-02")
	return w, nil
}
