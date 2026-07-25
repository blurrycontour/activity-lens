package httpapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/ingest"
	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

const maxUploadBytes = 25 << 20 // 25 MiB

func (s *Server) handleListWorkouts(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	list, err := s.workout.ListSummary(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load workouts")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	wk, err := s.workout.Get(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, wk)
}

// createWorkoutRequest is the manual-entry payload from the import modal.
type createWorkoutRequest struct {
	Name          string  `json:"name"`
	Type          string  `json:"type"`
	Date          string  `json:"date"` // YYYY-MM-DD
	Duration      int     `json:"duration"`
	Distance      float64 `json:"distance"`
	AvgHR         int     `json:"avgHR"`
	MaxHR         int     `json:"maxHR"`
	ElevationGain float64 `json:"elevationGain"`
	Calories      int     `json:"calories"`
	Notes         string  `json:"notes"`
}

func (s *Server) handleCreateWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req createWorkoutRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	start := time.Now().UTC()
	if req.Date != "" {
		if t, err := time.Parse("2006-01-02", req.Date); err == nil {
			start = t.UTC()
		}
	}
	in := workout.Input{
		Name:          req.Name,
		Type:          workout.Type(req.Type),
		StartTime:     start,
		Duration:      req.Duration,
		Distance:      req.Distance,
		AvgHR:         req.AvgHR,
		MaxHR:         req.MaxHR,
		ElevationGain: req.ElevationGain,
		Calories:      req.Calories,
		Notes:         req.Notes,
	}
	wk, err := s.workout.Create(r.Context(), user.ID, in)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	slog.Info("workout created", "workout_id", wk.ID, "user_id", user.ID, "source", "manual")
	writeJSON(w, http.StatusCreated, wk)
}

func (s *Server) handlePatchWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Name     *string `json:"name"`
		Type     *string `json:"type"`
		Notes    *string `json:"notes"`
		Date     *string `json:"date"` // YYYY-MM-DD
		Calories *int    `json:"calories"`
		Steps    *int    `json:"steps"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	patch := workout.Patch{Name: req.Name, Notes: req.Notes, Calories: req.Calories, Steps: req.Steps}
	if req.Type != nil {
		t := workout.Type(*req.Type)
		patch.Type = &t
	}
	if req.Date != nil {
		t, err := time.Parse("2006-01-02", *req.Date)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid date")
			return
		}
		patch.StartTime = &t
	}
	wk, err := s.workout.Update(r.Context(), user.ID, r.PathValue("id"), patch)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	slog.Info("workout updated", "workout_id", wk.ID, "user_id", user.ID)
	writeJSON(w, http.StatusOK, wk)
}

func (s *Server) handleDeleteWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.workout.Delete(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	slog.Info("workout deleted", "workout_id", r.PathValue("id"), "user_id", user.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleImportWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, "could not read upload")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read file")
		return
	}

	defaultType := workout.TypeRun
	if t := workout.Type(r.FormValue("type")); workout.ValidType(t) {
		defaultType = t
	}

	in, err := ingest.Parse(header.Filename, data, defaultType)
	if err != nil {
		if errors.Is(err, ingest.ErrUnsupported) {
			writeError(w, http.StatusUnsupportedMediaType, "unsupported file format (use .gpx or .tcx)")
			return
		}
		writeError(w, http.StatusBadRequest, "could not parse file: "+err.Error())
		return
	}
	if name := r.FormValue("name"); name != "" {
		in.Name = name
	}
	if in.Calories == 0 {
		if prefs, err := s.settings.UserPreferences(r.Context(), user.ID); err == nil {
			in.Calories = estimateCalories(in, prefs.CalorieMethod, prefs.BodyWeightKg)
		}
	}

	wk, err := s.workout.Create(r.Context(), user.ID, in)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	slog.Info("workout imported", "workout_id", wk.ID, "user_id", user.ID, "filename", header.Filename, "bytes", len(data))

	if s.rawUploads != nil {
		if keep, err := s.settings.StoredStorage(r.Context()); err == nil && keep.KeepOriginalUploads {
			contentType := header.Header.Get("Content-Type")
			if contentType == "" {
				contentType = "application/octet-stream"
			}
			if err := s.rawUploads.Save(r.Context(), wk.ID, header.Filename, contentType, data); err != nil {
				slog.Warn("could not save original upload", "workout_id", wk.ID, "error", err)
			}
		}
	}

	writeJSON(w, http.StatusCreated, wk)
}

func estimateCalories(in workout.Input, method string, weightKg float64) int {
	return workout.EstimateCalories(in.Type, in.Duration, in.AvgHR, in.Distance, weightKg, method)
}

func (s *Server) handleRecalculateWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	prefs, err := s.settings.UserPreferences(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load preferences")
		return
	}
	wk, err := s.workout.Recalculate(r.Context(), user.ID, r.PathValue("id"), prefs.CalorieMethod, prefs.BodyWeightKg)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	slog.Info("workout recalculated", "workout_id", wk.ID, "user_id", user.ID)
	writeJSON(w, http.StatusOK, wk)
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	st, err := s.workout.Stats(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not compute stats")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleGetPreferences(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	prefs, err := s.settings.UserPreferences(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load preferences")
		return
	}
	writeJSON(w, http.StatusOK, prefs)
}

func (s *Server) handleSavePreferences(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		CalorieMethod string  `json:"calorieMethod"`
		BodyWeightKg  float64 `json:"bodyWeightKg"`
		MaxHR         int     `json:"maxHr"`
		RestingHR     int     `json:"restingHr"`
		ThresholdPace string  `json:"thresholdPace"`
		FTP           int     `json:"ftp"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	method := req.CalorieMethod
	if method != "heart-rate" && method != "distance" {
		method = "heart-rate"
	}
	weight := req.BodyWeightKg
	if weight <= 0 {
		weight = 70
	}
	clampNonNeg := func(n int) int {
		if n < 0 {
			return 0
		}
		return n
	}
	prefs := settings.UserPrefs{
		CalorieMethod: method,
		BodyWeightKg:  weight,
		MaxHR:         clampNonNeg(req.MaxHR),
		RestingHR:     clampNonNeg(req.RestingHR),
		ThresholdPace: strings.TrimSpace(req.ThresholdPace),
		FTP:           clampNonNeg(req.FTP),
	}
	if err := s.settings.SaveUserPreferences(r.Context(), user.ID, prefs); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save preferences")
		return
	}
	writeJSON(w, http.StatusOK, prefs)
}

func (s *Server) writeWorkoutError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, workout.ErrNotFound):
		writeError(w, http.StatusNotFound, "workout not found")
	case errors.Is(err, workout.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}
