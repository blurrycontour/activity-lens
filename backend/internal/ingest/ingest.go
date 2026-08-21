// Package ingest parses activity files (GPX, TCX, FIT) into a workout.Input.
// Everything is decoded with the standard library — XML for the first two, and
// a decoder for FIT's binary records in fit.go; no third-party format
// dependencies.
package ingest

import (
	"fmt"
	"math"
	"path/filepath"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// trackPoint is a normalized sample shared by all parsers.
type trackPoint struct {
	Lat, Lng float64
	HasLL    bool
	Elev     float64
	HasElev  bool
	HR       int
	HasHR    bool
	Cad      int
	HasCad   bool
	Time     time.Time
	HasTime  bool
	// Speed as the device recorded it, in metres per second. Preferred over
	// anything derived from GPS fixes: the watch fuses the same fixes with an
	// accelerometer or a foot pod and knows its own error, which two
	// coordinates and a clock cannot.
	Speed    float64
	HasSpeed bool
}

// The window a derived pace sample is averaged over: it closes after this many
// seconds, or this many metres, whichever happens first.
//
// Both bounds are needed. Time alone gives a sprinter a sample every 40 m and a
// walker one every 8, and distance alone never closes the window at all while
// someone is standing still. Together they hold the sample rate roughly steady
// across the range of speeds a person actually moves at, which is what makes
// the resulting chart readable rather than spiky.
const (
	paceWindowSec    = 5
	paceWindowMetres = 25
)

// Pace bounds, in seconds per kilometre. Outside these a sample is dropped
// rather than clamped.
//
// The fast end rejects GPS teleports — a fix that lands 200 m away is not a
// 90 km/h sprint, and one such sample rescales the whole chart's axis. The slow
// end is where "moving" stops meaning anything: a 40-minute kilometre is a rest
// stop, and drawing it flattens every real variation in the activity into a
// line at the bottom of the plot.
const (
	minPaceSecPerKm = 100
	maxPaceSecPerKm = 2400
)

// paceFromSpeed converts metres per second to seconds per kilometre, reporting
// whether the result is a speed worth plotting.
func paceFromSpeed(metresPerSec float64) (int, bool) {
	if metresPerSec <= 0 {
		return 0, false
	}
	pace := 1000 / metresPerSec
	if pace < minPaceSecPerKm || pace > maxPaceSecPerKm {
		return 0, false
	}
	return int(math.Round(pace)), true
}

// ErrUnsupported is returned for file extensions we cannot parse.
var ErrUnsupported = fmt.Errorf("ingest: unsupported file format")

// Parse detects the format from the filename and returns a workout.Input.
// defaultType is used when the file does not declare an activity type.
func Parse(filename string, data []byte, defaultType workout.Type) (workout.Input, error) {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".gpx":
		return parseGPX(data, defaultType)
	case ".tcx":
		return parseTCX(data, defaultType)
	case ".fit":
		return parseFIT(data, defaultType)
	default:
		return workout.Input{}, ErrUnsupported
	}
}

// buildInput turns a sequence of track points into a workout.Input, deriving
// distance, elevation gain, duration, and per-metric timelines. fallbackStart
// is used as the activity start time when no track point carries a timestamp
// (e.g. a route-only GPX file); when zero, time.Now() is used as a last resort.
func buildInput(name string, typ workout.Type, points []trackPoint, calories int, fallbackStart time.Time) workout.Input {
	in := workout.Input{
		Name:  name,
		Type:  typ,
		Route: []workout.LatLng{},
		// A non-zero figure here came out of the file itself (TCX states
		// calories per lap); zero means the caller will have to estimate.
		Calories:         calories,
		CaloriesReported: calories > 0,
	}
	if len(points) == 0 {
		if !fallbackStart.IsZero() {
			in.StartTime = fallbackStart.UTC()
		} else {
			in.StartTime = time.Now().UTC()
		}
		return in
	}

	var (
		start        time.Time
		haveStart    bool
		prevLat      float64
		prevLng      float64
		havePrev     bool
		prevElev     float64
		havePrevEl   bool
		distance     float64
		elevGain     float64
		hrSum        int
		hrCount      int
		maxHR        int
		prevPaceLat  float64
		prevPaceLng  float64
		prevPaceT    int
		havePrevPace bool
		// Set as soon as one point carries a recorded speed. The two sources
		// must not be mixed: a file where only some points have the field
		// would otherwise interleave measured and derived samples on different
		// scales, which reads as noise.
		usedFileSpeed bool
	)

	for _, p := range points {
		if p.HasTime && !haveStart {
			start = p.Time
			haveStart = true
		}
		var tSec int
		if p.HasTime && haveStart {
			tSec = int(p.Time.Sub(start).Seconds())
		}

		if p.HasLL {
			in.Route = append(in.Route, workout.LatLng{p.Lat, p.Lng})
			if havePrev {
				distance += haversine(prevLat, prevLng, p.Lat, p.Lng)
			}
			prevLat, prevLng, havePrev = p.Lat, p.Lng, true
		}
		if p.HasElev {
			if havePrevEl && p.Elev > prevElev {
				elevGain += p.Elev - prevElev
			}
			prevElev, havePrevEl = p.Elev, true
			in.ElevTimeline = append(in.ElevTimeline, workout.ElevPoint{T: tSec, Elev: int(math.Round(p.Elev))})
		}
		if p.HasHR {
			hrSum += p.HR
			hrCount++
			if p.HR > maxHR {
				maxHR = p.HR
			}
			in.HRTimeline = append(in.HRTimeline, workout.HRPoint{T: tSec, HR: p.HR})
		}
		if p.HasCad {
			in.CadenceTimeline = append(in.CadenceTimeline, workout.CadencePoint{T: tSec, Cad: p.Cad})
		}
		// A recorded speed is used as-is; only files without one get a derived
		// series. See paceWindow for what "derived" has to mean to be usable.
		if p.HasSpeed && p.HasTime && haveStart {
			usedFileSpeed = true
			if pace, ok := paceFromSpeed(p.Speed); ok {
				in.PaceTimeline = append(in.PaceTimeline, workout.PacePoint{T: tSec, Pace: pace})
			}
		} else if !usedFileSpeed && p.HasLL && p.HasTime && haveStart {
			if havePrevPace {
				segDist := haversine(prevPaceLat, prevPaceLng, p.Lat, p.Lng)
				dt := tSec - prevPaceT
				// The window closes on whichever comes first: enough time for
				// the average to mean something, or enough ground covered that
				// it does. Crucially the previous point only advances when it
				// does close — leaving it to advance every fix is what broke
				// this. Each sample was one second of GPS noise, and at any
				// speed where a second covers less than the distance floor
				// (walking, most of a hike) the sample was simply dropped and
				// the next one measured from the point that replaced it. The
				// result was a sparse series of the jitteriest moments in the
				// activity, which is exactly what the charts showed.
				if dt >= paceWindowSec || segDist >= paceWindowMetres {
					if pace, ok := paceFromSpeed(segDist / float64(dt)); ok {
						in.PaceTimeline = append(in.PaceTimeline, workout.PacePoint{T: tSec, Pace: pace})
					}
					prevPaceLat, prevPaceLng, prevPaceT = p.Lat, p.Lng, tSec
				}
			} else {
				prevPaceLat, prevPaceLng, prevPaceT, havePrevPace = p.Lat, p.Lng, tSec, true
			}
		}
	}

	if haveStart {
		in.StartTime = start.UTC()
		last := points[len(points)-1]
		if last.HasTime {
			in.Duration = int(last.Time.Sub(start).Seconds())
		}
	} else if !fallbackStart.IsZero() {
		in.StartTime = fallbackStart.UTC()
	} else {
		in.StartTime = time.Now().UTC()
	}
	in.Distance = distance
	in.ElevationGain = elevGain
	if hrCount > 0 {
		in.AvgHR = hrSum / hrCount
		in.MaxHR = maxHR
	}
	normalizeCadence(&in)
	return in
}

// perFootCadenceCeiling is the highest average cadence we still read as
// "one foot only". Foot pods and Garmin's RunCadence/gpxtpx:cad fields report
// steps for a single foot, so a run averaging 85 there is really 170 steps per
// minute — the number every other tracker shows. Averaging above this ceiling
// would mean over 240 total steps per minute, which no human sustains, so the
// file must already be reporting both feet and is left alone.
const perFootCadenceCeiling = 120

// normalizeCadence doubles per-foot cadence samples for foot-based activities
// so the stored series is always total steps per minute. Ride cadence (rpm) is
// per-crank by definition and never scaled.
func normalizeCadence(in *workout.Input) {
	if len(in.CadenceTimeline) == 0 || (in.Type != workout.TypeRun && in.Type != workout.TypeHike) {
		return
	}
	sum := 0
	for _, p := range in.CadenceTimeline {
		sum += p.Cad
	}
	if avg := sum / len(in.CadenceTimeline); avg == 0 || avg > perFootCadenceCeiling {
		return
	}
	for i := range in.CadenceTimeline {
		in.CadenceTimeline[i].Cad *= 2
	}
}

// haversine returns the great-circle distance between two points in meters.
func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371000.0 // Earth radius, meters
	φ1 := lat1 * math.Pi / 180
	φ2 := lat2 * math.Pi / 180
	dφ := (lat2 - lat1) * math.Pi / 180
	dλ := (lng2 - lng1) * math.Pi / 180
	a := math.Sin(dφ/2)*math.Sin(dφ/2) + math.Cos(φ1)*math.Cos(φ2)*math.Sin(dλ/2)*math.Sin(dλ/2)
	return r * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
