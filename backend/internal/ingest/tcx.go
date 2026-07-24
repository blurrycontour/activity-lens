package ingest

import (
	"encoding/xml"
	"fmt"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// tcxFile mirrors the subset of the Garmin TCX schema we consume.
type tcxFile struct {
	XMLName    xml.Name `xml:"TrainingCenterDatabase"`
	Activities struct {
		Activity []struct {
			Sport string `xml:"Sport,attr"`
			Laps  []struct {
				StartTime string `xml:"StartTime,attr"`
				Calories  int    `xml:"Calories"`
				Tracks    []struct {
					Points []tcxPoint `xml:"Trackpoint"`
				} `xml:"Track"`
			} `xml:"Lap"`
		} `xml:"Activity"`
	} `xml:"Activities"`
}

type tcxPoint struct {
	Time     string `xml:"Time"`
	Position *struct {
		Lat float64 `xml:"LatitudeDegrees"`
		Lng float64 `xml:"LongitudeDegrees"`
	} `xml:"Position"`
	Altitude *float64 `xml:"AltitudeMeters"`
	HR       *struct {
		Value int `xml:"Value"`
	} `xml:"HeartRateBpm"`
}

func parseTCX(data []byte, defaultType workout.Type) (workout.Input, error) {
	var f tcxFile
	if err := xml.Unmarshal(data, &f); err != nil {
		return workout.Input{}, fmt.Errorf("parse tcx: %w", err)
	}
	if len(f.Activities.Activity) == 0 {
		return workout.Input{}, fmt.Errorf("parse tcx: no activities found")
	}

	act := f.Activities.Activity[0]
	points := make([]trackPoint, 0)
	calories := 0
	var fallbackStart time.Time
	for _, lap := range act.Laps {
		calories += lap.Calories
		if fallbackStart.IsZero() && lap.StartTime != "" {
			if ts, err := time.Parse(time.RFC3339, lap.StartTime); err == nil {
				fallbackStart = ts
			}
		}
		for _, trk := range lap.Tracks {
			for _, p := range trk.Points {
				tp := trackPoint{}
				if p.Position != nil {
					tp.Lat, tp.Lng, tp.HasLL = p.Position.Lat, p.Position.Lng, true
				}
				if p.Altitude != nil {
					tp.Elev, tp.HasElev = *p.Altitude, true
				}
				if p.HR != nil {
					tp.HR, tp.HasHR = p.HR.Value, true
				}
				if p.Time != "" {
					if ts, err := time.Parse(time.RFC3339, p.Time); err == nil {
						tp.Time, tp.HasTime = ts, true
					}
				}
				points = append(points, tp)
			}
		}
	}

	name := strings.TrimSpace(act.Sport)
	if name == "" {
		name = "Imported Activity"
	} else {
		name += " Activity"
	}
	return buildInput(name, mapType(act.Sport, defaultType), points, calories, fallbackStart), nil
}
