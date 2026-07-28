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
	user := httpmw.UserFrom(r)
	e, err := s.equipment.Get(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeEquipmentError(w, err)
		return
	}
	workouts, err := s.equipment.LinkedWorkouts(r.Context(), user.ID, e.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load linked workouts")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		*equipment.Equipment
		Workouts []equipment.LinkedWorkout `json:"workouts"`
	}{e, workouts})
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
