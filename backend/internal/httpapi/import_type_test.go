package httpapi

import (
	"bytes"
	"mime/multipart"
	"net/http/httptest"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// A TCX that declares it is a run, so the file and the user can disagree.
const runTCX = `<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Running">
<Lap StartTime="2024-01-10T06:00:00Z"><Calories>200</Calories><Track>
<Trackpoint><Time>2024-01-10T06:00:05Z</Time><Position><LatitudeDegrees>1.0</LatitudeDegrees><LongitudeDegrees>2.0</LongitudeDegrees></Position></Trackpoint>
<Trackpoint><Time>2024-01-10T06:10:05Z</Time><Position><LatitudeDegrees>1.01</LatitudeDegrees><LongitudeDegrees>2.01</LongitudeDegrees></Position></Trackpoint>
</Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`

func parseUpload(t *testing.T, body, sport string) workout.Input {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, _ := mw.CreateFormFile("file", "activity.tcx")
	_, _ = part.Write([]byte(body))
	if sport != "" {
		_ = mw.WriteField("type", sport)
	}
	_ = mw.Close()

	req := httptest.NewRequest("POST", "/api/workouts/import", &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())

	s := &Server{settings: settings.New(weatherTestDB(t))}
	in, _, _, ok := s.parseWorkoutUpload(httptest.NewRecorder(), req, 1)
	if !ok {
		t.Fatal("parseWorkoutUpload rejected the upload")
	}
	return in
}

// The sport picked in the import window is the user's own answer, and the whole
// point of having it is to save the trip to the workout page afterwards — so
// overruling it with the file's declaration would defeat the feature.
func TestChosenSportOverrulesTheFile(t *testing.T) {
	in := parseUpload(t, runTCX, string(workout.TypeHike))
	if in.Type != workout.TypeHike {
		t.Errorf("Type = %q, want Hike — the user picked it", in.Type)
	}
}

// Left on "Detect", the client sends no type at all and the file decides.
func TestDetectLeavesTheFileInCharge(t *testing.T) {
	in := parseUpload(t, runTCX, "")
	if in.Type != workout.TypeRun {
		t.Errorf("Type = %q, want Run from the file", in.Type)
	}
}

// A file that declares nothing and says nothing lands in Other rather than
// whatever the import default used to be.
func TestUndeclaredUploadsLandInOther(t *testing.T) {
	quiet := `<?xml version="1.0"?>
<TrainingCenterDatabase><Activities><Activity Sport="Other">
<Notes>Sunday morning</Notes>
<Lap StartTime="2024-01-10T06:00:00Z"><Calories>200</Calories><Track>
<Trackpoint><Time>2024-01-10T06:00:05Z</Time><Position><LatitudeDegrees>1.0</LatitudeDegrees><LongitudeDegrees>2.0</LongitudeDegrees></Position></Trackpoint>
</Track></Lap>
</Activity></Activities></TrainingCenterDatabase>`
	if in := parseUpload(t, quiet, ""); in.Type != workout.TypeOther {
		t.Errorf("Type = %q, want Other", in.Type)
	}
}

// Other is not something a client may assert: it means "we could not tell", and
// a client claiming it would be asserting a conclusion rather than a choice.
func TestClientsCannotChooseOther(t *testing.T) {
	if in := parseUpload(t, runTCX, string(workout.TypeOther)); in.Type != workout.TypeRun {
		t.Errorf("Type = %q, want Run — Other is not a choice a client may send", in.Type)
	}
}
