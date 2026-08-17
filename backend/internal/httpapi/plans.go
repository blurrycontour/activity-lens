package httpapi

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/plans"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// withPlans refuses the training-plan routes on a server built without the
// service, rather than panicking on a nil pointer inside the handler.
func (s *Server) withPlans(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if s.plans == nil {
			writeError(w, http.StatusNotFound, "training plans are not enabled")
			return
		}
		h(w, r)
	}
}

// --- Plans ---------------------------------------------------------------

func (s *Server) handleListPlans(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	list, err := s.plans.ListPlans(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load plans")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetPlan(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	p, err := s.plans.GetPlan(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleCreatePlan(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Name  string `json:"name"`
		Notes string `json:"notes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	p, err := s.plans.CreatePlan(r.Context(), user.ID, plans.PlanInput{Name: req.Name, Notes: req.Notes})
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	slog.Info("plan created", "plan_id", p.ID, "user_id", user.ID)
	writeJSON(w, http.StatusCreated, p)
}

func (s *Server) handlePatchPlan(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Name     *string `json:"name"`
		Notes    *string `json:"notes"`
		Archived *bool   `json:"archived"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	p, err := s.plans.UpdatePlan(r.Context(), user.ID, r.PathValue("id"),
		plans.PlanPatch{Name: req.Name, Notes: req.Notes, Archived: req.Archived})
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (s *Server) handleDeletePlan(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.plans.DeletePlan(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writePlanError(w, err)
		return
	}
	slog.Info("plan deleted", "plan_id", r.PathValue("id"), "user_id", user.ID)
	w.WriteHeader(http.StatusNoContent)
}

// handlePutPlanDays replaces a plan's whole day structure.
//
// One write for the whole tree, not per-row endpoints: the editor autosaves
// the thing it is editing, and a partial apply across four levels is a state
// no client could sensibly recover from. It answers with the saved plan so the
// editor picks up the ids the server issued for anything newly added.
func (s *Server) handlePutPlanDays(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Days []plans.Day `json:"days"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	p, err := s.plans.ReplaceDays(r.Context(), user.ID, r.PathValue("id"), req.Days)
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// handleExerciseNames answers the editor's name suggestions.
//
// Its own endpoint rather than widening the plans list: the list draws a dozen
// rows and has no business downloading every exercise of every plan to do it,
// and these names are wanted on a screen that has not loaded the other plans
// at all.
func (s *Server) handleExerciseNames(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	names, err := s.plans.ExerciseNames(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load exercise names")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Names []string `json:"names"`
	}{names})
}

// --- Sessions ------------------------------------------------------------

func (s *Server) handleStartPlanSession(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		PlanID string `json:"planId"`
		DayID  string `json:"dayId"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	sess, err := s.plans.StartSession(r.Context(), user.ID, req.PlanID, req.DayID)
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	slog.Info("plan session started", "session_id", sess.ID, "user_id", user.ID, "plan_id", req.PlanID)
	writeJSON(w, http.StatusCreated, sess)
}

// handleActivePlanSession answers the dashboard's "is one running?".
//
// 204 rather than 404 for "no": the dashboard asks on every load and the
// common answer is no, which is not an error and should not read as one in a
// log or a network panel.
func (s *Server) handleActivePlanSession(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	sess, err := s.plans.ActiveSession(r.Context(), user.ID)
	if errors.Is(err, plans.ErrNotFound) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load session")
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (s *Server) handleListPlanSessions(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	list, err := s.plans.ListSessions(r.Context(), user.ID, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load sessions")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

func (s *Server) handleGetPlanSession(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	sess, err := s.plans.GetSession(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

func (s *Server) handleSavePlanProgress(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Progress plans.Progress `json:"progress"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	sess, err := s.plans.SaveProgress(r.Context(), user.ID, r.PathValue("id"), req.Progress)
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, sess)
}

// handleFinishPlanSession closes a session and, when the user has asked for it,
// records a manual strength workout alongside.
//
// The workout is created before the session is closed so that a failure there
// leaves the session open and retryable, rather than finished with a missing
// record the user cannot ask for again.
func (s *Server) handleFinishPlanSession(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Notes string `json:"notes"`
		// Progress is accepted here as well so the last few ticks cannot be
		// lost to a failed autosave immediately before finishing.
		Progress *plans.Progress `json:"progress"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id := r.PathValue("id")
	if req.Progress != nil {
		if _, err := s.plans.SaveProgress(r.Context(), user.ID, id, *req.Progress); err != nil {
			s.writePlanError(w, err)
			return
		}
	}
	sess, err := s.plans.GetSession(r.Context(), user.ID, id)
	if err != nil {
		s.writePlanError(w, err)
		return
	}

	workoutID := s.workoutForSession(r, user.ID, sess)

	sess, err = s.plans.FinishSession(r.Context(), user.ID, id, req.Notes, workoutID)
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	slog.Info("plan session finished", "session_id", sess.ID, "user_id", user.ID,
		"done_sets", sess.DoneSets, "workout_id", workoutID)
	writeJSON(w, http.StatusOK, sess)
}

// workoutForSession creates the manual strength workout for a finished
// session, when the user's preferences ask for one. Returns "" otherwise.
//
// Failures are logged and swallowed: the session is the record that matters,
// and refusing to finish a workout in the gym because a derived row could not
// be written would be the wrong trade.
func (s *Server) workoutForSession(r *http.Request, userID int64, sess *plans.Session) string {
	prefs, err := s.settings.UserPreferences(r.Context(), userID)
	if err != nil || !prefs.PlanWorkouts {
		return ""
	}
	if sess.DoneSets == 0 {
		return ""
	}
	start, err := time.Parse(time.RFC3339, sess.StartedAt)
	if err != nil {
		start = time.Now().UTC()
	}
	// Duration is measured, not estimated: a session that was started and
	// finished has two timestamps, and the elapsed time between them is the
	// only honest number available without asking the user.
	duration := int(time.Since(start).Seconds())
	if duration < 0 {
		duration = 0
	}
	wk, err := s.workout.Create(r.Context(), userID, workout.Input{
		Name:      sess.PlanName + " · " + sess.DayName,
		Type:      workout.TypeStrength,
		StartTime: start.UTC(),
		Duration:  duration,
		Notes: fmt.Sprintf("%d of %d sets from %s.", sess.DoneSets, sess.TotalSets,
			sess.PlanName),
		Source: workout.SourceManual,
	})
	if err != nil {
		slog.Warn("could not create workout for plan session",
			"session_id", sess.ID, "user_id", userID, "error", err)
		return ""
	}
	s.afterWorkoutRecorded(r, userID)
	return wk.ID
}

func (s *Server) handleDeletePlanSession(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.plans.DeleteSession(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writePlanError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDeletePlanSessions clears a batch of history rows.
func (s *Server) handleDeletePlanSessions(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		IDs []string `json:"ids"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	deleted, err := s.plans.DeleteSessions(r.Context(), user.ID, req.IDs)
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	slog.Info("plan sessions deleted", "user_id", user.ID, "count", deleted)
	writeJSON(w, http.StatusOK, struct {
		Deleted int `json:"deleted"`
	}{deleted})
}

func (s *Server) writePlanError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, plans.ErrNotFound):
		writeError(w, http.StatusNotFound, "not found")
	case errors.Is(err, plans.ErrSessionRunning):
		// 409, not 400: the request is well formed and will succeed once the
		// open session is finished or discarded, which is what the client
		// offers to do with this.
		writeError(w, http.StatusConflict, "a session is already running")
	case errors.Is(err, plans.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}
