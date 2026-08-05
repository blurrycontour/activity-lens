package httpapi

import (
	"net/http"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// Weather a person supplies, and the backfill of workouts that predate the
// feature. The automatic lookup itself lives in scheduler.go — nothing here
// touches the network.

// weatherRequest is the manual-entry payload.
//
// Plain values rather than pointers: this replaces the whole reading rather
// than patching one field of it, because a half-corrected set of conditions is
// harder to reason about than a re-entered one, and the form shows every field
// anyway.
type weatherRequest struct {
	TempC     float64 `json:"tempC"`
	ApparentC float64 `json:"apparentC"`
	Humidity  float64 `json:"humidity"`
	WindKph   float64 `json:"windKph"`
	PrecipMm  float64 `json:"precipMm"`
	Code      int     `json:"code"`
}

// handleSetWorkoutWeather records conditions the owner typed in.
//
// These outrank anything fetched and are never overwritten by a later lookup:
// someone entering their own reading has a thermometer, or a memory, and either
// beats a 25 km grid average. See workout.WeatherManual.
func (s *Server) handleSetWorkoutWeather(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req weatherRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	in := workout.Weather{
		TempC:     req.TempC,
		ApparentC: req.ApparentC,
		Humidity:  req.Humidity,
		WindKph:   req.WindKph,
		PrecipMm:  req.PrecipMm,
		Code:      req.Code,
	}
	// An apparent temperature nobody supplied should not read as a hard 0 °C
	// next to a real air temperature. Defaulting it to the air temperature is
	// what the fetcher does for an hour with no value, for the same reason.
	if req.ApparentC == 0 && req.TempC != 0 {
		in.ApparentC = req.TempC
	}
	if err := s.workout.SetManualWeather(r.Context(), user.ID, r.PathValue("id"), in); err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	s.writeWorkoutAfterWeatherChange(w, r, user.ID)
}

// handleClearWorkoutWeather undoes a manual entry, putting the workout back in
// the queue so the next pass fills it in again. A mis-typed temperature should
// be recoverable without deleting the workout.
func (s *Server) handleClearWorkoutWeather(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.workout.ClearManualWeather(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	s.writeWorkoutAfterWeatherChange(w, r, user.ID)
}

// writeWorkoutAfterWeatherChange returns the updated workout, so the client
// re-renders from what was actually stored rather than from what it hoped was.
func (s *Server) writeWorkoutAfterWeatherChange(w http.ResponseWriter, r *http.Request, userID int64) {
	wk, err := s.workout.Get(r.Context(), userID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	s.attachEquipment(r, userID, wk)
	writeJSON(w, http.StatusOK, workoutDetailResponse{
		Workout: wk, IsOwner: true, HasOriginal: wk.RawFilename != "",
	})
}

// handleWeatherBackfillStatus reports how many workouts have never been checked.
//
// This is what lets the UI offer the backfill with a number instead of a vague
// promise — and, when it is zero, not offer it at all.
func (s *Server) handleWeatherBackfillStatus(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	n, err := s.workout.WeatherBackfillable(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not count workouts")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"pending": n})
}

// handleRequestWeatherBackfill queues this user's older workouts for a lookup.
//
// Deliberately an explicit action rather than something that happens when the
// setting is switched on. The setting governs workouts imported from now on;
// this one sends a coarse location and a timestamp for every run already in the
// library to a third party, which is a different decision and deserves to be
// made rather than inherited.
//
// Returns immediately: the background pass drains the queue at its own pace, so
// this does not have to hold a request open for a library of any size.
func (s *Server) handleRequestWeatherBackfill(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	n, err := s.workout.RequestWeatherBackfill(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not queue workouts")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"queued": n})
}
