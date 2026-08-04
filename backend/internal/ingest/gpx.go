package ingest

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"

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
	return buildInput(name, mapType(trk.Type, defaultType), points, 0, fallbackStart), nil
}

// mapType maps a GPX/TCX activity type string onto our Type set, falling back
// to def when unknown.
func mapType(raw string, def workout.Type) workout.Type {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "run", "running", "9":
		return workout.TypeRun
	case "ride", "biking", "cycling", "bike", "1":
		return workout.TypeRide
	case "hike", "hiking", "walking", "walk":
		return workout.TypeHike
	case "swim", "swimming":
		return workout.TypeSwim
	case "strength", "strength_training", "workout":
		return workout.TypeStrength
	default:
		if workout.ValidType(workout.Type(raw)) {
			return workout.Type(raw)
		}
		return def
	}
}
