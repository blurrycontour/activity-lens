package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/ingest"
	"github.com/blurrycontour/activity-lens/backend/internal/notify"
	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

const maxUploadBytes = 25 << 20 // 25 MiB

// handleListWorkouts returns the caller's own library — never anyone else's.
// The dashboard, stats and consistency views all assume that.
func (s *Server) handleListWorkouts(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	list, err := s.workout.ListSummary(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load workouts")
		return
	}
	// One grouped query annotates the whole library, so the list can badge
	// shared workouts without a per-row lookup.
	if counts, err := s.workout.ShareCounts(r.Context(), user.ID); err == nil {
		for i := range list {
			list[i].SharedWithCount = counts[list[i].ID]
		}
	} else {
		slog.Warn("could not load share counts", "error", err)
	}
	writeJSON(w, http.StatusOK, list)
}

// workoutDetailResponse wraps a workout with whether the caller owns it, so the
// client knows to offer edit controls. It is a response concern, not a domain
// one, which is why it does not live on workout.Workout.
type workoutDetailResponse struct {
	*workout.Workout
	IsOwner bool `json:"isOwner"`
}

func (s *Server) handleGetWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	wk, isOwner, err := s.workout.GetViewable(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	if isOwner {
		s.attachEquipment(r, user.ID, wk)
	} else if owner, derr := s.ownerRef(r, wk.UserID); derr == nil {
		// Equipment is deliberately left off: it is the owner's private gear
		// inventory, not part of the workout being shared.
		wk.Owner = owner
	}
	writeJSON(w, http.StatusOK, workoutDetailResponse{Workout: wk, IsOwner: isOwner})
}

// createWorkoutRequest is the manual-entry payload from the import modal.
type createWorkoutRequest struct {
	Name          string   `json:"name"`
	Type          string   `json:"type"`
	Date          string   `json:"date"` // YYYY-MM-DD
	Duration      int      `json:"duration"`
	Distance      float64  `json:"distance"`
	AvgHR         int      `json:"avgHR"`
	MaxHR         int      `json:"maxHR"`
	ElevationGain float64  `json:"elevationGain"`
	Calories      int      `json:"calories"`
	Notes         string   `json:"notes"`
	EquipmentIDs  []string `json:"equipmentIds"`
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
		Source:        workout.SourceManual,
	}
	if prefs, err := s.settings.UserPreferences(r.Context(), user.ID); err == nil {
		in.StepLengthM = stepLengthMeters(prefs)
	}
	wk, err := s.workout.Create(r.Context(), user.ID, in)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	s.linkEquipment(r, user.ID, wk, req.EquipmentIDs)
	slog.Info("workout created", "workout_id", wk.ID, "user_id", user.ID, "source", "manual")
	s.afterWorkoutRecorded(r, user.ID)
	writeJSON(w, http.StatusCreated, wk)
}

func (s *Server) handlePatchWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Name         *string   `json:"name"`
		Type         *string   `json:"type"`
		Notes        *string   `json:"notes"`
		Date         *string   `json:"date"` // YYYY-MM-DD
		Calories     *int      `json:"calories"`
		Steps        *int      `json:"steps"`
		EquipmentIDs *[]string `json:"equipmentIds"`
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
	if req.EquipmentIDs != nil {
		if err := s.equipment.SetForWorkout(r.Context(), user.ID, wk.ID, *req.EquipmentIDs); err != nil {
			slog.Warn("could not set workout equipment", "workout_id", wk.ID, "error", err)
		}
	}
	s.attachEquipment(r, user.ID, wk)
	// The client splices this response back into its cached list, so the share
	// count has to come along or an unrelated edit would blank the row's badge.
	if ids, err := s.workout.ShareRecipients(r.Context(), user.ID, wk.ID); err == nil {
		wk.SharedWithCount = len(ids)
	}
	slog.Info("workout updated", "workout_id", wk.ID, "user_id", user.ID)
	writeJSON(w, http.StatusOK, wk)
}

// linkEquipment associates the given equipment ids with a workout (best-effort;
// failures are logged) and attaches the resulting equipment to the workout.
func (s *Server) linkEquipment(r *http.Request, userID int64, wk *workout.Workout, ids []string) {
	if len(ids) > 0 {
		if err := s.equipment.SetForWorkout(r.Context(), userID, wk.ID, ids); err != nil {
			slog.Warn("could not set workout equipment", "workout_id", wk.ID, "error", err)
		}
	}
	s.attachEquipment(r, userID, wk)
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

// importResponse is a workout plus a flag telling the client this file had
// already been imported. The workout is embedded so its fields stay at the top
// level of the JSON object and existing clients are unaffected.
type importResponse struct {
	*workout.Workout
	Duplicate bool `json:"duplicate,omitempty"`
}

func (s *Server) handleImportWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	in, data, header, ok := s.parseWorkoutUpload(w, r, user.ID)
	if !ok {
		return
	}

	wk, created, err := s.workout.CreateIdempotent(r.Context(), user.ID, in)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	// An already-imported file resolves to the stored workout as-is: re-linking
	// equipment would clobber edits the user has since made to it, and the
	// original bytes are already archived.
	if !created {
		s.attachEquipment(r, user.ID, wk)
		slog.Info("workout import skipped (duplicate)", "workout_id", wk.ID, "user_id", user.ID, "filename", header.Filename)
		writeJSON(w, http.StatusOK, importResponse{Workout: wk, Duplicate: true})
		return
	}
	var equipmentIDs []string
	if r.MultipartForm != nil {
		equipmentIDs = r.MultipartForm.Value["equipmentIds"]
	}
	s.linkEquipment(r, user.ID, wk, equipmentIDs)
	slog.Info("workout imported", "workout_id", wk.ID, "user_id", user.ID, "filename", header.Filename, "bytes", len(data))
	s.afterWorkoutRecorded(r, user.ID)

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

	writeJSON(w, http.StatusCreated, importResponse{Workout: wk})
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
	// Identify the upload by its content so re-importing the same file (a
	// repeated share from a tracker app, a double-click on Import) resolves to
	// the workout already stored rather than creating a second copy.
	sum := sha256.Sum256(data)
	in.Source = workout.SourceUpload
	in.ContentHash = hex.EncodeToString(sum[:])
	in.ExternalID = in.ContentHash
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

		Goals []struct {
			ID     string  `json:"id"`
			Count  int     `json:"count"`
			Period string  `json:"period"`
			Type   string  `json:"type"`
			MinKm  float64 `json:"minKm"`
		} `json:"goals"`

		Notify *struct {
			Kinds map[string]bool `json:"kinds"`
			Push  bool            `json:"push"`
		} `json:"notify"`
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
	// Goals are validated individually and silently dropped when they could
	// never be met, so one bad row can't reject an otherwise valid save.
	goals := make([]settings.Goal, 0, len(req.Goals))
	for _, g := range req.Goals {
		if g.Count <= 0 {
			continue
		}
		period := g.Period
		if period != "week" && period != "month" {
			period = "week"
		}
		// An empty type means "any activity counts".
		typ := g.Type
		if typ != "" && !workout.ValidType(workout.Type(typ)) {
			typ = ""
		}
		goals = append(goals, settings.Goal{
			ID:     g.ID,
			Count:  min(g.Count, maxGoalCount(period)),
			Period: period,
			Type:   typ,
			MinKm:  max(g.MinKm, 0),
		})
		if len(goals) >= 12 {
			break
		}
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

		Goals: goals,
	}
	// Unknown kinds are dropped so a stale or hand-crafted client cannot write
	// switches that nothing reads.
	if req.Notify != nil {
		kinds := make(map[notify.Kind]bool, len(req.Notify.Kinds))
		for k, enabled := range req.Notify.Kinds {
			if notify.ValidKind(notify.Kind(k)) {
				kinds[notify.Kind(k)] = enabled
			}
		}
		encoded, err := json.Marshal(notify.Prefs{Kinds: kinds, Push: req.Notify.Push})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not save preferences")
			return
		}
		prefs.Notify = encoded
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

// maxGoalCount caps a goal at roughly three activities a day for its period —
// beyond that it is a typo rather than a plan.
func maxGoalCount(period string) int {
	if period == "month" {
		return 93
	}
	return 21
}
