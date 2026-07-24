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
