package ingest

import (
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
