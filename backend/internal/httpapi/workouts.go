package httpapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/ingest"
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
	writeJSON(w, http.StatusCreated, wk)
}

func (s *Server) handlePatchWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Name  *string `json:"name"`
		Type  *string `json:"type"`
		Notes *string `json:"notes"`
		Date  *string `json:"date"` // YYYY-MM-DD
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	patch := workout.Patch{Name: req.Name, Notes: req.Notes}
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
	writeJSON(w, http.StatusOK, wk)
}

func (s *Server) handleDeleteWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.workout.Delete(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeWorkoutError(w, err)
		return
	}
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

	wk, err := s.workout.Create(r.Context(), user.ID, in)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}

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

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	st, err := s.workout.Stats(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not compute stats")
		return
	}
	writeJSON(w, http.StatusOK, st)
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
