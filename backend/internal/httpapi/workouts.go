package httpapi

import (
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
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
	if prefs, err := s.settings.UserPreferences(r.Context(), user.ID); err == nil {
		in.StepLengthM = stepLengthMeters(prefs)
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
	in, data, header, ok := s.parseWorkoutUpload(w, r, user.ID)
	if !ok {
		return
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

// handlePreviewWorkout parses an uploaded file and returns the derived metrics
// without persisting anything, so the client can show the numbers before the
// user commits to saving the workout.
func (s *Server) handlePreviewWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	in, _, _, ok := s.parseWorkoutUpload(w, r, user.ID)
	if !ok {
		return
	}
	wk, err := s.workout.Preview(in)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, wk)
}

// parseWorkoutUpload reads a multipart file upload, parses it into a workout
// Input, applies an optional name override, and fills in an estimated calorie
// value from the user's preferences when the file has none. On any failure it
// writes an error response and returns ok=false.
func (s *Server) parseWorkoutUpload(w http.ResponseWriter, r *http.Request, userID int64) (workout.Input, []byte, *multipart.FileHeader, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, "could not read upload")
		return workout.Input{}, nil, nil, false
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return workout.Input{}, nil, nil, false
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read file")
		return workout.Input{}, nil, nil, false
	}

	defaultType := workout.TypeRun
	if t := workout.Type(r.FormValue("type")); workout.ValidType(t) {
		defaultType = t
	}

	in, err := ingest.Parse(header.Filename, data, defaultType)
	if err != nil {
		if errors.Is(err, ingest.ErrUnsupported) {
			writeError(w, http.StatusUnsupportedMediaType, "unsupported file format (use .gpx or .tcx)")
			return workout.Input{}, nil, nil, false
		}
		writeError(w, http.StatusBadRequest, "could not parse file: "+err.Error())
		return workout.Input{}, nil, nil, false
	}
	if name := r.FormValue("name"); name != "" {
		in.Name = name
	}
	if prefs, err := s.settings.UserPreferences(r.Context(), userID); err == nil {
		in.StepLengthM = stepLengthMeters(prefs)
		if in.Calories == 0 {
			in.Calories = estimateCalories(in, prefs)
		}
	}
	return in, data, header, true
}

func estimateCalories(in workout.Input, prefs settings.UserPrefs) int {
	return workout.EstimateCalories(in.Type, in.Duration, in.AvgHR, in.Distance, prefs.BodyWeightKg, ageFromPrefs(prefs), prefs.Sex, prefs.CalorieMethod)
}

// stepLengthMeters converts a user's stored stride length (cm) to metres, or 0
// when unset so the workout service falls back to per-activity defaults.
func stepLengthMeters(prefs settings.UserPrefs) float64 {
	if prefs.StepLengthCm <= 0 {
		return 0
	}
	return float64(prefs.StepLengthCm) / 100
}

// clampStepLength keeps a user-supplied stride length within a plausible human
// range (cm); anything outside it is treated as unset (0 = activity default).
func clampStepLength(cm int) int {
	if cm < 30 || cm > 200 {
		return 0
	}
	return cm
}

// ageFromPrefs returns the user's age derived from their birth year, or 0 when
// no birth year has been set.
func ageFromPrefs(prefs settings.UserPrefs) int {
	if prefs.BirthYear <= 0 {
		return 0
	}
	age := time.Now().UTC().Year() - prefs.BirthYear
	if age < 0 || age > 120 {
		return 0
	}
	return age
}

func (s *Server) handleRecalculateWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	prefs, err := s.settings.UserPreferences(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load preferences")
		return
	}
	wk, err := s.workout.Recalculate(r.Context(), user.ID, r.PathValue("id"), prefs.CalorieMethod, prefs.BodyWeightKg, ageFromPrefs(prefs), prefs.Sex, stepLengthMeters(prefs))
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
		Sex           string  `json:"sex"`
		BirthYear     int     `json:"birthYear"`
		HeightCm      int     `json:"heightCm"`
		MaxHR         int     `json:"maxHr"`
		RestingHR     int     `json:"restingHr"`
		ThresholdPace string  `json:"thresholdPace"`
		FTP           int     `json:"ftp"`
		StepLengthCm  int     `json:"stepLengthCm"`
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
	sex := req.Sex
	if sex != "male" && sex != "female" {
		sex = ""
	}
	birthYear := req.BirthYear
	if birthYear != 0 && (birthYear < 1900 || birthYear > time.Now().UTC().Year()) {
		birthYear = 0
	}
	prefs := settings.UserPrefs{
		CalorieMethod: method,
		BodyWeightKg:  weight,
		Sex:           sex,
		BirthYear:     birthYear,
		HeightCm:      clampNonNeg(req.HeightCm),
		MaxHR:         clampNonNeg(req.MaxHR),
		RestingHR:     clampNonNeg(req.RestingHR),
		ThresholdPace: strings.TrimSpace(req.ThresholdPace),
		FTP:           clampNonNeg(req.FTP),
		StepLengthCm:  clampStepLength(req.StepLengthCm),
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
