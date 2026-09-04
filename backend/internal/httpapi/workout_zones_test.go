package httpapi

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

func TestAttachAthleteHRZonesUsesWorkoutOwner(t *testing.T) {
	db := weatherTestDB(t)
	prefs := settings.New(db)
	if err := prefs.SaveUserPreferences(context.Background(), 7, settings.UserPrefs{
		MaxHR: 191, RestingHR: 53, HRZoneMethod: "reserve",
	}); err != nil {
		t.Fatal(err)
	}

	server := &Server{settings: prefs}
	wk := &workout.Workout{UserID: 7}
	server.attachAthleteHRZones(httptest.NewRequest("GET", "/", nil), wk)

	if wk.AthleteMaxHR != 191 || wk.AthleteRestingHR != 53 || wk.AthleteHRZoneMethod != "reserve" {
		t.Fatalf("workout HR zones = max %d, resting %d, method %q",
			wk.AthleteMaxHR, wk.AthleteRestingHR, wk.AthleteHRZoneMethod)
	}
}
