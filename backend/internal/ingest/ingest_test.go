package ingest

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

func TestParseGPXUsesTrackPointTime(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<gpx><trk><name>Morning Run</name><type>running</type><trkseg>
<trkpt lat="1.0" lon="2.0"><ele>10</ele><time>2024-03-15T07:30:00Z</time></trkpt>
<trkpt lat="1.001" lon="2.001"><ele>11</ele><time>2024-03-15T07:31:00Z</time></trkpt>
</trkseg></trk></gpx>`)
	in, err := parseGPX(data, workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2024, 3, 15, 7, 30, 0, 0, time.UTC)
	if !in.StartTime.Equal(want) {
		t.Fatalf("StartTime = %v, want %v", in.StartTime, want)
	}
}

func TestParseGPXFallsBackToMetadataTime(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<gpx><metadata><time>2023-06-01T09:00:00Z</time></metadata>
<trk><name>Route</name><trkseg>
<trkpt lat="1.0" lon="2.0"><ele>10</ele></trkpt>
<trkpt lat="1.001" lon="2.001"><ele>11</ele></trkpt>
</trkseg></trk></gpx>`)
	in, err := parseGPX(data, workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2023, 6, 1, 9, 0, 0, 0, time.UTC)
	if !in.StartTime.Equal(want) {
		t.Fatalf("StartTime = %v, want %v (metadata fallback)", in.StartTime, want)
	}
}

func TestParseTCXUsesTrackPointTime(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Running">
<Lap StartTime="2024-01-10T06:00:00Z"><Calories>200</Calories><Track>
<Trackpoint><Time>2024-01-10T06:00:05Z</Time><Position><LatitudeDegrees>1.0</LatitudeDegrees><LongitudeDegrees>2.0</LongitudeDegrees></Position></Trackpoint>
</Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`)
	in, err := parseTCX(data, workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2024, 1, 10, 6, 0, 5, 0, time.UTC)
	if !in.StartTime.Equal(want) {
		t.Fatalf("StartTime = %v, want %v", in.StartTime, want)
	}
}

func TestParseTCXFallsBackToLapStartTime(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Running">
<Lap StartTime="2024-01-10T06:00:00Z"><Calories>200</Calories><Track>
<Trackpoint><Position><LatitudeDegrees>1.0</LatitudeDegrees><LongitudeDegrees>2.0</LongitudeDegrees></Position></Trackpoint>
</Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`)
	in, err := parseTCX(data, workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	want := time.Date(2024, 1, 10, 6, 0, 0, 0, time.UTC)
	if !in.StartTime.Equal(want) {
		t.Fatalf("StartTime = %v, want %v (lap StartTime fallback)", in.StartTime, want)
	}
}

func TestParseTCXRunCadenceIsDoubledToTotalSteps(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<TrainingCenterDatabase xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Running">
<Lap StartTime="2024-01-10T06:00:00Z"><Calories>412</Calories><Track>
<Trackpoint><Time>2024-01-10T06:00:00Z</Time><Extensions><ns3:TPX><ns3:RunCadence>86</ns3:RunCadence></ns3:TPX></Extensions></Trackpoint>
<Trackpoint><Time>2024-01-10T06:00:10Z</Time><Extensions><ns3:TPX><ns3:RunCadence>88</ns3:RunCadence></ns3:TPX></Extensions></Trackpoint>
</Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`)
	in, err := parseTCX(data, workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	want := []workout.CadencePoint{{T: 0, Cad: 172}, {T: 10, Cad: 176}}
	if len(in.CadenceTimeline) != len(want) {
		t.Fatalf("CadenceTimeline = %v, want %v", in.CadenceTimeline, want)
	}
	for i := range want {
		if in.CadenceTimeline[i] != want[i] {
			t.Fatalf("CadenceTimeline = %v, want %v", in.CadenceTimeline, want)
		}
	}
	if in.Calories != 412 || !in.CaloriesReported {
		t.Fatalf("Calories = %d reported=%v, want 412 reported=true", in.Calories, in.CaloriesReported)
	}
}

func TestParseTCXBikeCadenceIsNotDoubled(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Biking">
<Lap StartTime="2024-01-10T06:00:00Z"><Track>
<Trackpoint><Time>2024-01-10T06:00:00Z</Time><Cadence>90</Cadence></Trackpoint>
</Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`)
	in, err := parseTCX(data, workout.TypeRide)
	if err != nil {
		t.Fatal(err)
	}
	if len(in.CadenceTimeline) != 1 || in.CadenceTimeline[0].Cad != 90 {
		t.Fatalf("CadenceTimeline = %v, want one 90 rpm sample", in.CadenceTimeline)
	}
	if in.CaloriesReported {
		t.Fatal("CaloriesReported = true, want false when the file states no calories")
	}
}

func TestParseGPXKeepsAlreadyTotalRunCadence(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<gpx><trk><name>Run</name><type>running</type><trkseg>
<trkpt lat="1.0" lon="2.0"><time>2024-03-15T07:30:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:cad>174</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="1.001" lon="2.001"><time>2024-03-15T07:30:10Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:cad>178</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
</trkseg></trk></gpx>`)
	in, err := parseGPX(data, workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	if len(in.CadenceTimeline) != 2 || in.CadenceTimeline[0].Cad != 174 || in.CadenceTimeline[1].Cad != 178 {
		t.Fatalf("CadenceTimeline = %v, want 174/178 left unscaled", in.CadenceTimeline)
	}
}

func TestParseTCXPrefersRecordedSpeed(t *testing.T) {
	// The positions say roughly 3.6 km/h; the recorded speed says 4 m/s. The
	// file wins, because the watch knows things two coordinates do not.
	data := []byte(`<?xml version="1.0"?>
<TrainingCenterDatabase xmlns:ns3="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
<Activities><Activity Sport="Running">
<Lap StartTime="2024-01-10T06:00:00Z"><Track>
<Trackpoint><Time>2024-01-10T06:00:00Z</Time><Position><LatitudeDegrees>52.0</LatitudeDegrees><LongitudeDegrees>13.0</LongitudeDegrees></Position><Extensions><ns3:TPX><ns3:Speed>4.0</ns3:Speed></ns3:TPX></Extensions></Trackpoint>
<Trackpoint><Time>2024-01-10T06:00:01Z</Time><Position><LatitudeDegrees>52.00001</LatitudeDegrees><LongitudeDegrees>13.0</LongitudeDegrees></Position><Extensions><ns3:TPX><ns3:Speed>5.0</ns3:Speed></ns3:TPX></Extensions></Trackpoint>
</Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`)
	in, err := parseTCX(data, workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	want := []workout.PacePoint{{T: 0, Pace: 250}, {T: 1, Pace: 200}}
	if len(in.PaceTimeline) != len(want) {
		t.Fatalf("PaceTimeline = %v, want %v", in.PaceTimeline, want)
	}
	for i := range want {
		if in.PaceTimeline[i] != want[i] {
			t.Fatalf("PaceTimeline = %v, want %v", in.PaceTimeline, want)
		}
	}
}

func TestDerivedPaceCoversSlowMovement(t *testing.T) {
	// A walk at about 1.4 m/s with one-second fixes: every single step is well
	// under the old 3 m floor, which used to leave the series empty. The
	// window has to accumulate across fixes for this to produce anything.
	var b strings.Builder
	b.WriteString(`<?xml version="1.0"?><gpx><trk><name>Walk</name><type>walking</type><trkseg>`)
	base := time.Date(2024, 1, 10, 6, 0, 0, 0, time.UTC)
	for i := 0; i < 60; i++ {
		// ~1.4 m north per second.
		lat := 52.0 + float64(i)*0.0000126
		fmt.Fprintf(&b, `<trkpt lat="%.7f" lon="13.0"><time>%s</time></trkpt>`, lat, base.Add(time.Duration(i)*time.Second).Format(time.RFC3339))
	}
	b.WriteString(`</trkseg></trk></gpx>`)

	in, err := parseGPX([]byte(b.String()), workout.TypeHike)
	if err != nil {
		t.Fatal(err)
	}
	if len(in.PaceTimeline) < 8 {
		t.Fatalf("PaceTimeline has %d samples, want a regular series over a 60s walk: %v", len(in.PaceTimeline), in.PaceTimeline)
	}
	// About 12 min/km. Wide bounds — this is asserting the series is in the
	// right neighbourhood, not the exact windowing.
	for _, p := range in.PaceTimeline {
		if p.Pace < 600 || p.Pace > 900 {
			t.Fatalf("pace sample %v is not a walking pace; series = %v", p, in.PaceTimeline)
		}
	}
}

func TestDerivedPaceDropsGPSTeleports(t *testing.T) {
	// A single fix 500 m from its neighbours, one second apart. Left in, it
	// rescales the whole chart's axis to a speed no human reaches.
	data := []byte(`<?xml version="1.0"?>
<gpx><trk><name>Run</name><type>running</type><trkseg>
<trkpt lat="52.0000000" lon="13.0"><time>2024-01-10T06:00:00Z</time></trkpt>
<trkpt lat="52.0045000" lon="13.0"><time>2024-01-10T06:00:01Z</time></trkpt>
<trkpt lat="52.0000300" lon="13.0"><time>2024-01-10T06:00:02Z</time></trkpt>
</trkseg></trk></gpx>`)
	in, err := parseGPX(data, workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range in.PaceTimeline {
		if p.Pace < minPaceSecPerKm {
			t.Fatalf("kept an impossible pace sample %v; series = %v", p, in.PaceTimeline)
		}
	}
}
