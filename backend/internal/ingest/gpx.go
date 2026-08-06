package ingest

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"
	"unicode"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// gpxFile mirrors the subset of the GPX 1.1 schema we consume, including the
// Garmin TrackPointExtension for heart rate.
type gpxFile struct {
	XMLName  xml.Name `xml:"gpx"`
	Metadata struct {
		Time string `xml:"time"`
	} `xml:"metadata"`
	Tracks []struct {
		Name     string `xml:"name"`
		Type     string `xml:"type"`
		Segments []struct {
			Points []gpxPoint `xml:"trkpt"`
		} `xml:"trkseg"`
	} `xml:"trk"`
}

type gpxPoint struct {
	Lat  float64  `xml:"lat,attr"`
	Lng  float64  `xml:"lon,attr"`
	Elev *float64 `xml:"ele"`
	Time string   `xml:"time"`
	Ext  struct {
		// Matches <gpxtpx:hr>/<gpxtpx:cad> under any TrackPointExtension namespace.
		HR  *int `xml:"TrackPointExtension>hr"`
		Cad *int `xml:"TrackPointExtension>cad"`
		// Metres per second. Rarer than hr/cad, but Strava and several phone
		// trackers write it, and it beats deriving from the fixes.
		Speed *float64 `xml:"TrackPointExtension>speed"`
	} `xml:"extensions"`
}

func parseGPX(data []byte, defaultType workout.Type) (workout.Input, error) {
	var f gpxFile
	if err := xml.Unmarshal(data, &f); err != nil {
		return workout.Input{}, fmt.Errorf("parse gpx: %w", err)
	}
	if len(f.Tracks) == 0 {
		return workout.Input{}, fmt.Errorf("parse gpx: no tracks found")
	}

	trk := f.Tracks[0]
	points := make([]trackPoint, 0)
	for _, seg := range trk.Segments {
		for _, p := range seg.Points {
			tp := trackPoint{Lat: p.Lat, Lng: p.Lng, HasLL: true}
			if p.Elev != nil {
				tp.Elev, tp.HasElev = *p.Elev, true
			}
			if p.Ext.HR != nil {
				tp.HR, tp.HasHR = *p.Ext.HR, true
			}
			if p.Ext.Cad != nil {
				tp.Cad, tp.HasCad = *p.Ext.Cad, true
			}
			if p.Ext.Speed != nil {
				tp.Speed, tp.HasSpeed = *p.Ext.Speed, true
			}
			if p.Time != "" {
				if ts, err := time.Parse(time.RFC3339, p.Time); err == nil {
					tp.Time, tp.HasTime = ts, true
				}
			}
			points = append(points, tp)
		}
	}

	name := strings.TrimSpace(trk.Name)
	if name == "" {
		name = "Imported Activity"
	}
	var fallbackStart time.Time
	if f.Metadata.Time != "" {
		if ts, err := time.Parse(time.RFC3339, f.Metadata.Time); err == nil {
			fallbackStart = ts
		}
	}
	// The track name is the only free text a GPX carries, and exporters that
	// omit <type> often put the activity in it — "Morning Hike".
	return buildInput(name, mapType(trk.Type, []string{trk.Name}, defaultType), points, 0, fallbackStart), nil
}

// matchType maps one word or phrase onto our Type set, reporting whether it
// meant anything. The reporting is the point: a caller that cannot tell "this
// file says Run" from "this file says nothing I recognise" has nowhere else to
// look, which is how a TCX declaring Sport="Other" became a Run.
func matchType(raw string) (workout.Type, bool) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "run", "running", "9":
		return workout.TypeRun, true
	case "ride", "biking", "cycling", "bike", "1":
		return workout.TypeRide, true
	case "hike", "hiking", "walking", "walk", "trekking":
		return workout.TypeHike, true
	case "swim", "swimming":
		return workout.TypeSwim, true
	case "strength", "strength_training", "workout", "gym", "weights":
		return workout.TypeStrength, true
	case "other", "unknown", "":
		// Never a match, even though workout.TypeOther exists and ValidType
		// accepts it below. A file saying "Other" is telling us it does not
		// know, which is the cue to go and read its free text — treating it as
		// an answer is what stops the Notes from ever being consulted.
		return "", false
	default:
		if workout.ValidType(workout.Type(strings.TrimSpace(raw))) {
			return workout.Type(strings.TrimSpace(raw)), true
		}
		return "", false
	}
}

// inferType reads an activity type out of free text — a track name, or a TCX
// Notes field.
//
// Watches that export everything as Sport="Other" routinely put the name the
// user chose in Notes, and that name is usually just the activity: "Hiking".
// So the whole string is tried first, and only then its individual words.
//
// A word scan alone would be reckless — "Ran into a friend at the pool" names
// two activities and means neither — so it answers only when the words agree on
// exactly one. Guessing wrong here is worse than not guessing: a hike filed as
// a run corrupts pace records and the temperature correlation silently, where
// an unrecognised activity merely falls back to the default.
func inferType(text string) (workout.Type, bool) {
	// matchType also accepts Garmin's numeric sport codes, which are meaningful
	// in a <type> element and meaningless in a name — a track called "1" is a
	// lap, not a bike ride. Free text never gets to use them.
	if isNumeric(text) {
		return "", false
	}
	if t, ok := matchType(text); ok {
		return t, true
	}
	var found workout.Type
	for _, word := range strings.FieldsFunc(text, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	}) {
		// Bare numbers are lap counts and distances far more often than they are
		// the Garmin sport codes matchType also accepts, and a track called
		// "Evening 9" is not a run.
		if isNumeric(word) {
			continue
		}
		t, ok := matchType(word)
		if !ok {
			continue
		}
		if found != "" && found != t {
			return "", false
		}
		found = t
	}
	return found, found != ""
}

// isNumeric reports whether s is nothing but digits.
func isNumeric(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.IsDigit(r) {
			return false
		}
	}
	return true
}

// mapType maps a declared activity type onto our Type set, consulting the free
// text a file also carries before falling back to def.
func mapType(raw string, hints []string, def workout.Type) workout.Type {
	if t, ok := matchType(raw); ok {
		return t
	}
	for _, h := range hints {
		if t, ok := inferType(h); ok {
			return t
		}
	}
	return def
}
