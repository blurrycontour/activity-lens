package httpapi

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/vitals"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// vitalRequest is the POST /api/vitals body. Every reading is optional so one
// endpoint serves both the weight quick-add and the blood-pressure one; the
// service rejects a body that carries neither.
type vitalRequest struct {
	// MeasuredAt is an RFC3339 timestamp; empty means "now".
	MeasuredAt string   `json:"measuredAt"`
	WeightKg   *float64 `json:"weightKg"`
	Systolic   *int     `json:"systolic"`
	Diastolic  *int     `json:"diastolic"`
	Pulse      *int     `json:"pulse"`
	Note       string   `json:"note"`
}

func (s *Server) handleListVitals(w http.ResponseWriter, r *http.Request) {
	if s.vitals == nil {
		writeError(w, http.StatusNotFound, "vitals are not enabled")
		return
	}
	user := httpmw.UserFrom(r)
	// Optional ?days=N window, so the charts can ask for a range without
	// pulling a lifetime of readings. Absent or non-positive means all.
	var since time.Time
	if v := r.URL.Query().Get("days"); v != "" {
		if days, err := strconv.Atoi(v); err == nil && days > 0 {
			since = time.Now().UTC().AddDate(0, 0, -days)
		}
	}
	list, err := s.vitals.List(r.Context(), user.ID, since)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load vitals")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleCreateVital(w http.ResponseWriter, r *http.Request) {
	if s.vitals == nil {
		writeError(w, http.StatusNotFound, "vitals are not enabled")
		return
	}
	user := httpmw.UserFrom(r)
	var req vitalRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	when := time.Time{}
	if req.MeasuredAt != "" {
		t, err := time.Parse(time.RFC3339, req.MeasuredAt)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid measuredAt")
			return
		}
		when = t
	}
	v, err := s.vitals.Create(r.Context(), user.ID, vitals.Input{
		MeasuredAt: when, WeightKg: req.WeightKg, Systolic: req.Systolic, Diastolic: req.Diastolic, Pulse: req.Pulse, Note: req.Note,
	})
	if err != nil {
		s.writeVitalError(w, err)
		return
	}
	// Weight is unified with the profile: the latest logged weight is the one
	// calorie and power estimates use, so a new reading updates it.
	if v.HasWeight() {
		s.syncBodyWeightToLatest(r, user.ID)
	}
	slog.Info("vital recorded", "vital_id", v.ID, "user_id", user.ID)
	writeJSON(w, http.StatusCreated, v)
}

func (s *Server) handleDeleteVital(w http.ResponseWriter, r *http.Request) {
	if s.vitals == nil {
		writeError(w, http.StatusNotFound, "vitals are not enabled")
		return
	}
	user := httpmw.UserFrom(r)
	if err := s.vitals.Delete(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeVitalError(w, err)
		return
	}
	// Cheap and always correct: whatever was removed, re-point the profile
	// weight at whatever the newest remaining reading is.
	s.syncBodyWeightToLatest(r, user.ID)
	w.WriteHeader(http.StatusNoContent)
}

// handleLatestWeight answers the single number Settings needs to show what
// "logged" weight mode would apply, without the page fetching the whole
// vitals history for it.
func (s *Server) handleLatestWeight(w http.ResponseWriter, r *http.Request) {
	if s.vitals == nil {
		writeError(w, http.StatusNotFound, "vitals are not enabled")
		return
	}
	user := httpmw.UserFrom(r)
	kg, err := s.vitals.LatestWeight(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load latest weight")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		WeightKg *float64 `json:"weightKg"`
	}{kg})
}

// syncBodyWeightToLatest keeps the profile's body weight equal to the most
// recent logged weight, the single source of truth the unified design settles
// on. Best-effort: a failure here leaves the last-known weight in place rather
// than failing the measurement the user just saved.
func (s *Server) syncBodyWeightToLatest(r *http.Request, userID int64) {
	prefs, err := s.settings.UserPreferences(r.Context(), userID)
	if err != nil {
		return
	}
	// A hand-entered profile weight is deliberately independent of the log, so
	// a new weigh-in must not overwrite it.
	if prefs.BodyWeightManual {
		return
	}
	latest, err := s.vitals.LatestWeight(r.Context(), userID)
	if err != nil || latest == nil || prefs.BodyWeightKg == *latest {
		return
	}
	prefs.BodyWeightKg = *latest
	if err := s.settings.SaveUserPreferences(r.Context(), userID, prefs); err != nil {
		slog.Warn("could not sync body weight from vitals", "user_id", userID, "error", err)
	}
}

func (s *Server) writeVitalError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, vitals.ErrNotFound):
		writeError(w, http.StatusNotFound, "measurement not found")
	case errors.Is(err, vitals.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "could not save measurement")
	}
}
