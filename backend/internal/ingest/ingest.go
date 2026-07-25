// Package ingest parses activity files (GPX, TCX) into a workout.Input. Only
// standard-library XML parsing is used; no third-party format dependencies.
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
	Time     time.Time
	HasTime  bool
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
		Name:     name,
		Type:     typ,
		Calories: calories,
		Route:    []workout.LatLng{},
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
		// Most GPX/TCX exports don't carry a pace/speed field directly, so it
		// is derived here from consecutive GPS fixes and their timestamps
		// (distance / elapsed time). A minimum segment distance avoids
		// division blow-ups from GPS jitter while stationary.
		if p.HasLL && p.HasTime && haveStart {
			if havePrevPace {
				segDist := haversine(prevPaceLat, prevPaceLng, p.Lat, p.Lng)
				dt := tSec - prevPaceT
				if dt > 0 && segDist >= 3 {
					paceSecPerKm := float64(dt) / (segDist / 1000)
					in.PaceTimeline = append(in.PaceTimeline, workout.PacePoint{T: tSec, Pace: int(math.Round(paceSecPerKm))})
				}
			}
			prevPaceLat, prevPaceLng, prevPaceT, havePrevPace = p.Lat, p.Lng, tSec, true
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
	return in
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
