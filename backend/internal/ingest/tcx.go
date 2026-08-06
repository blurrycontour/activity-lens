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
			// Notes is optional in the schema and is where several watches put
			// the name the user gave the activity. It is the only thing that
			// distinguishes one Sport="Other" export from another — TCX offers
			// exactly three sports, so anything that is not a run, a ride or a
			// walk arrives as "Other" with the real answer sitting here.
			Notes string `xml:"Notes"`
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
	// Bike cadence (rpm) lives directly on the trackpoint; running cadence is
	// carried in Garmin's ActivityExtension TPX block instead. Both are matched
	// namespace-agnostically by encoding/xml.
	Cadence    *int `xml:"Cadence"`
	RunCadence *int `xml:"Extensions>TPX>RunCadence"`
	// Metres per second, from the same Garmin ActivityExtension block. Present
	// in most watch exports and better than anything we could derive.
	Speed *float64 `xml:"Extensions>TPX>Speed"`
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
				if p.RunCadence != nil {
					tp.Cad, tp.HasCad = *p.RunCadence, true
				} else if p.Cadence != nil {
					tp.Cad, tp.HasCad = *p.Cadence, true
				}
				if p.Speed != nil {
					tp.Speed, tp.HasSpeed = *p.Speed, true
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

	return buildInput(
		tcxName(act.Notes, act.Sport),
		mapType(act.Sport, []string{act.Notes}, defaultType),
		points, calories, fallbackStart,
	), nil
}

// tcxName picks what to call the activity.
//
// Notes wins when it is there: it is the name a person chose on their watch,
// where the sport is at best a category and at worst the literal word "Other".
// Kept to one line, because some exporters use Notes as a lap-by-lap log and
// the first line is the title in every one seen so far.
func tcxName(notes, sport string) string {
	if line, _, _ := strings.Cut(notes, "\n"); strings.TrimSpace(line) != "" {
		return truncateName(strings.TrimSpace(line))
	}
	if sport = strings.TrimSpace(sport); sport != "" && !strings.EqualFold(sport, "other") {
		// "Other Activity" tells a reader nothing they could not see from the
		// blank space where a name should be.
		return sport + " Activity"
	}
	return "Imported Activity"
}

// truncateName keeps a free-text name to something a list row can show. Cut on
// a rune boundary, since a name can be any language.
func truncateName(s string) string {
	const maxNameRunes = 80
	r := []rune(s)
	if len(r) <= maxNameRunes {
		return s
	}
	return strings.TrimSpace(string(r[:maxNameRunes])) + "…"
}
