package ingest

import (
	"fmt"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// TCX offers three sports — Running, Biking, Other — so every watch that
// records anything else exports it as "Other". Filed as the import default that
// became a Run, which is not a cosmetic mislabel: it puts a hike into pace
// records it can never legitimately hold and into the temperature correlation
// as though it were the same activity.

func tcxDoc(sport, notes string) []byte {
	return []byte(fmt.Sprintf(`<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport=%q>
<Notes>%s</Notes>
<Lap StartTime="2024-01-10T06:00:00Z"><Calories>200</Calories><Track>
<Trackpoint><Time>2024-01-10T06:00:05Z</Time><Position><LatitudeDegrees>1.0</LatitudeDegrees><LongitudeDegrees>2.0</LongitudeDegrees></Position></Trackpoint>
</Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`, sport, notes))
}

func TestTCXNotesClassifyAnOtherActivity(t *testing.T) {
	in, err := parseTCX(tcxDoc("Other", "Hiking"), workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	if in.Type != workout.TypeHike {
		t.Errorf("Type = %q, want Hike — the notes say so", in.Type)
	}
	// And the name a person chose beats "Other Activity".
	if in.Name != "Hiking" {
		t.Errorf("Name = %q, want %q", in.Name, "Hiking")
	}
}

// The declared sport is still the better evidence where there is one: notes
// mentioning another activity must not override it.
func TestDeclaredSportOutranksTheNotes(t *testing.T) {
	in, err := parseTCX(tcxDoc("Running", "Hiking trail loop"), workout.TypeHike)
	if err != nil {
		t.Fatal(err)
	}
	if in.Type != workout.TypeRun {
		t.Errorf("Type = %q, want Run — the file declares it", in.Type)
	}
	if in.Name != "Hiking trail loop" {
		t.Errorf("Name = %q, want the notes", in.Name)
	}
}

func TestUnreadableNotesFallBackToTheDefault(t *testing.T) {
	in, err := parseTCX(tcxDoc("Other", "Sunday morning"), workout.TypeRide)
	if err != nil {
		t.Fatal(err)
	}
	if in.Type != workout.TypeRide {
		t.Errorf("Type = %q, want the caller's default Ride", in.Type)
	}
	if in.Name != "Sunday morning" {
		t.Errorf("Name = %q, want the notes even though they named no activity", in.Name)
	}
}

func TestNoNotesLeavesTheOldBehaviour(t *testing.T) {
	in, err := parseTCX(tcxDoc("Biking", ""), workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	if in.Type != workout.TypeRide {
		t.Errorf("Type = %q, want Ride", in.Type)
	}
	if in.Name != "Biking Activity" {
		t.Errorf("Name = %q, want %q", in.Name, "Biking Activity")
	}
	// "Other Activity" is a name that tells a reader nothing.
	blank, err := parseTCX(tcxDoc("Other", ""), workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	if blank.Name != "Imported Activity" {
		t.Errorf("Name = %q, want %q", blank.Name, "Imported Activity")
	}
}

// Guessing wrong is worse than not guessing: an unrecognised activity falls
// back to a default the user picked, where a wrong guess is silent.
func TestInferTypeRefusesToGuess(t *testing.T) {
	cases := []struct {
		text string
		want workout.Type
		ok   bool
	}{
		{"Hiking", workout.TypeHike, true},
		{"Morning Hike", workout.TypeHike, true},
		{"hike with the dog", workout.TypeHike, true},
		{"Gym", workout.TypeStrength, true},

		// Two activities named, so the text means neither.
		{"Ran into a friend at the pool", "", false},
		{"Run then bike", "", false},

		// Nothing to go on.
		{"", "", false},
		{"Sunday morning", "", false},
		{"   ", "", false},

		// A bare number is a lap count or a distance far more often than it is
		// the Garmin sport code that matchType also accepts.
		{"Evening 9", "", false},
		{"1", "", false},
	}
	for _, c := range cases {
		got, ok := inferType(c.text)
		if ok != c.ok || got != c.want {
			t.Errorf("inferType(%q) = %q,%v; want %q,%v", c.text, got, ok, c.want, c.ok)
		}
	}
}

// The same free-text reading applies to a GPX track name, where exporters that
// omit <type> routinely put the activity.
func TestGPXFallsBackToTheTrackName(t *testing.T) {
	data := []byte(`<?xml version="1.0"?>
<gpx><trk><name>Evening Hike</name><trkseg>
<trkpt lat="1.0" lon="2.0"><time>2024-01-10T06:00:05Z</time></trkpt>
</trkseg></trk></gpx>`)
	in, err := parseGPX(data, workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	if in.Type != workout.TypeHike {
		t.Errorf("Type = %q, want Hike from the track name", in.Type)
	}
}

// A name is free text from a device we do not control, and it ends up in a list
// row on a phone.
func TestLongNotesAreTruncated(t *testing.T) {
	long := ""
	for i := 0; i < 50; i++ {
		long += "hiking "
	}
	in, err := parseTCX(tcxDoc("Other", long), workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	if n := len([]rune(in.Name)); n > 81 {
		t.Errorf("name is %d runes, want it cut to something a row can show", n)
	}
	// Truncating the name must not cost the classification.
	if in.Type != workout.TypeHike {
		t.Errorf("Type = %q, want Hike", in.Type)
	}
}
