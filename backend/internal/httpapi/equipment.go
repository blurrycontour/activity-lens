package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/blurrycontour/activity-lens/backend/internal/equipment"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

func (s *Server) handleListEquipment(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	list, err := s.equipment.List(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load equipment")
		return
	}
	writeJSON(w, http.StatusOK, list)
}

type equipmentRequest struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Brand   string `json:"brand"`
	Model   string `json:"model"`
	Notes   string `json:"notes"`
	Retired bool   `json:"retired"`
	// RetireAtKm is the user's own replacement threshold; 0 falls back to the
	// per-type default.
	RetireAtKm float64 `json:"retireAtKm"`
}

func (s *Server) handleCreateEquipment(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req equipmentRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	e, err := s.equipment.Create(r.Context(), user.ID, equipment.Input{
		Name: req.Name, Type: req.Type, Brand: req.Brand, Model: req.Model, Notes: req.Notes, Retired: req.Retired,
		RetireAtKm: req.RetireAtKm,
	})
	if err != nil {
		s.writeEquipmentError(w, err)
		return
	}
	slog.Info("equipment created", "equipment_id", e.ID, "user_id", user.ID)
	writeJSON(w, http.StatusCreated, e)
}

func (s *Server) handleGetEquipment(w http.ResponseWriter, r *http.Request) {
	s.writeEquipmentDetail(w, r, httpmw.UserFrom(r).ID, r.PathValue("id"))
}

// writeEquipmentDetail answers with a piece of equipment and the workouts using
// it — the body the gear page renders. Shared by the read and by both writes
// that change the linked set, so a link and a reload can never disagree about
// the shape of what comes back.
func (s *Server) writeEquipmentDetail(w http.ResponseWriter, r *http.Request, userID int64, id string) {
	e, err := s.equipment.Get(r.Context(), userID, id)
	if err != nil {
		s.writeEquipmentError(w, err)
		return
	}
	workouts, err := s.equipment.LinkedWorkouts(r.Context(), userID, e.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load linked workouts")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		*equipment.Equipment
		Workouts []equipment.LinkedWorkout `json:"workouts"`
	}{e, workouts})
}

// handleLinkWorkouts adds workouts to a piece of equipment from the gear page.
//
// Additive, and deliberately not PATCH /api/workouts/{id} with an equipmentIds
// list: that one replaces a workout's whole kit, and the gear page knows only
// about itself. Linking a pair of shoes from here would have dropped the watch.
//
// It answers with the same body as GET, so the page has the new list, the
// workout count and the wear figures without a second round trip — all three
// change together and showing one updated beside two stale ones is worse than
// showing nothing.
func (s *Server) handleLinkWorkouts(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		WorkoutIDs []string `json:"workoutIds"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id := r.PathValue("id")
	linked, err := s.equipment.LinkWorkouts(r.Context(), user.ID, id, req.WorkoutIDs)
	if err != nil {
		s.writeEquipmentError(w, err)
		return
	}
	slog.Info("equipment linked to workouts", "equipment_id", id, "user_id", user.ID, "linked", linked)
	s.writeEquipmentDetail(w, r, user.ID, id)
}

func (s *Server) handleUnlinkWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	id := r.PathValue("id")
	if err := s.equipment.UnlinkWorkout(r.Context(), user.ID, id, r.PathValue("workoutId")); err != nil {
		s.writeEquipmentError(w, err)
		return
	}
	s.writeEquipmentDetail(w, r, user.ID, id)
}

func (s *Server) handlePatchEquipment(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Name       *string  `json:"name"`
		Type       *string  `json:"type"`
		Brand      *string  `json:"brand"`
		Model      *string  `json:"model"`
		Notes      *string  `json:"notes"`
		Retired    *bool    `json:"retired"`
		RetireAtKm *float64 `json:"retireAtKm"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	e, err := s.equipment.Update(r.Context(), user.ID, r.PathValue("id"), equipment.Patch{
		Name: req.Name, Type: req.Type, Brand: req.Brand, Model: req.Model, Notes: req.Notes, Retired: req.Retired,
		RetireAtKm: req.RetireAtKm,
	})
	if err != nil {
		s.writeEquipmentError(w, err)
		return
	}
	slog.Info("equipment updated", "equipment_id", e.ID, "user_id", user.ID)
	writeJSON(w, http.StatusOK, e)
}

func (s *Server) handleDeleteEquipment(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.equipment.Delete(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeEquipmentError(w, err)
		return
	}
	slog.Info("equipment deleted", "equipment_id", r.PathValue("id"), "user_id", user.ID)
	w.WriteHeader(http.StatusNoContent)
}

// attachEquipment loads the equipment linked to a workout and attaches it to
// the workout. Failures are logged but non-fatal so the workout still renders.
func (s *Server) attachEquipment(r *http.Request, userID int64, wk *workout.Workout) {
	list, err := s.equipment.ForWorkout(r.Context(), userID, wk.ID)
	if err != nil {
		slog.Warn("could not load workout equipment", "workout_id", wk.ID, "error", err)
		return
	}
	tags := make([]workout.EquipmentTag, 0, len(list))
	for _, e := range list {
		tags = append(tags, workout.EquipmentTag{ID: e.ID, Name: e.Name, Type: e.Type})
	}
	wk.Equipment = tags
}

func (s *Server) writeEquipmentError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, equipment.ErrNotFound):
		writeError(w, http.StatusNotFound, "equipment not found")
	case errors.Is(err, equipment.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}
