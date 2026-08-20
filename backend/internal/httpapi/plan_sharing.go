package httpapi

import (
	"context"
	"net/http"
	"strconv"

	"github.com/blurrycontour/activity-lens/backend/internal/plans"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// Sharing for plans and sessions. Mechanically the same shape as
// sharing.go's workout endpoints, reusing its domain-agnostic pieces
// unchanged: sharesResponse, userDirectory, ownerRef and lookupUser already
// carry no workout-specific assumption.

// --- Plans -----------------------------------------------------------------

func (s *Server) handleListPlanShares(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	s.writePlanShares(w, r, user.ID, r.PathValue("id"), http.StatusOK)
}

func (s *Server) handleSetPlanVisibility(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req setVisibilityRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id := r.PathValue("id")
	if err := s.plans.SetPlanVisibility(r.Context(), user.ID, id, workout.Visibility(req.Visibility)); err != nil {
		s.writePlanError(w, err)
		return
	}
	s.writePlanShares(w, r, user.ID, id, http.StatusOK)
}

func (s *Server) handleAddPlanShare(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req addShareRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	target, err := s.lookupUser(r, req.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	if target == nil {
		writeError(w, http.StatusBadRequest, "unknown user")
		return
	}
	id := r.PathValue("id")
	if err := s.plans.AddPlanShare(r.Context(), user.ID, id, req.UserID); err != nil {
		s.writePlanError(w, err)
		return
	}
	if p, err := s.plans.GetPlan(r.Context(), user.ID, id); err == nil {
		s.notifyPlanShared(r, *user, req.UserID, p)
	}
	s.writePlanShares(w, r, user.ID, id, http.StatusCreated)
}

func (s *Server) handleRemovePlanShare(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	targetID, err := strconv.ParseInt(r.PathValue("userId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if err := s.plans.RemovePlanShare(r.Context(), user.ID, r.PathValue("id"), targetID); err != nil {
		s.writePlanError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writePlanShares(w http.ResponseWriter, r *http.Request, ownerID int64, planID string, status int) {
	p, err := s.plans.GetPlan(r.Context(), ownerID, planID)
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	ids, err := s.plans.PlanShareRecipients(r.Context(), ownerID, planID)
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	dir, err := s.userDirectory(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	refs := make([]workout.OwnerRef, 0, len(ids))
	for _, id := range ids {
		if ref, ok := dir[id]; ok {
			refs = append(refs, ref)
		}
	}
	writeJSON(w, status, sharesResponse{Visibility: p.Visibility, SharedWith: refs})
}

func (s *Server) handleFeedPlansPublic(w http.ResponseWriter, r *http.Request) {
	s.writePlanFeed(w, r, s.plans.ListPublicPlans)
}

func (s *Server) handleFeedPlansShared(w http.ResponseWriter, r *http.Request) {
	s.writePlanFeed(w, r, s.plans.ListSharedPlansWithMe)
}

func (s *Server) writePlanFeed(w http.ResponseWriter, r *http.Request, load func(ctx context.Context, viewerID int64) ([]plans.Plan, error)) {
	user := httpmw.UserFrom(r)
	list, err := load(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load plans")
		return
	}
	dir, err := s.userDirectory(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	out := make([]plans.Plan, 0, len(list))
	for i := range list {
		ref, ok := dir[list[i].UserID]
		if !ok {
			continue
		}
		list[i].Owner = &ref
		out = append(out, list[i])
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) handleClonePlan(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	p, err := s.plans.ClonePlan(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// --- Sessions ------------------------------------------------------------

func (s *Server) handleListSessionShares(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	s.writeSessionShares(w, r, user.ID, r.PathValue("id"), http.StatusOK)
}

func (s *Server) handleSetSessionVisibility(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req setVisibilityRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id := r.PathValue("id")
	if err := s.plans.SetSessionVisibility(r.Context(), user.ID, id, workout.Visibility(req.Visibility)); err != nil {
		s.writePlanError(w, err)
		return
	}
	s.writeSessionShares(w, r, user.ID, id, http.StatusOK)
}

func (s *Server) handleAddSessionShare(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req addShareRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	target, err := s.lookupUser(r, req.UserID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	if target == nil {
		writeError(w, http.StatusBadRequest, "unknown user")
		return
	}
	id := r.PathValue("id")
	if err := s.plans.AddSessionShare(r.Context(), user.ID, id, req.UserID); err != nil {
		s.writePlanError(w, err)
		return
	}
	if sess, err := s.plans.GetSession(r.Context(), user.ID, id); err == nil {
		s.notifySessionShared(r, *user, req.UserID, sess)
	}
	s.writeSessionShares(w, r, user.ID, id, http.StatusCreated)
}

func (s *Server) handleRemoveSessionShare(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	targetID, err := strconv.ParseInt(r.PathValue("userId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if err := s.plans.RemoveSessionShare(r.Context(), user.ID, r.PathValue("id"), targetID); err != nil {
		s.writePlanError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writeSessionShares(w http.ResponseWriter, r *http.Request, ownerID int64, sessionID string, status int) {
	sess, err := s.plans.GetSession(r.Context(), ownerID, sessionID)
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	ids, err := s.plans.SessionShareRecipients(r.Context(), ownerID, sessionID)
	if err != nil {
		s.writePlanError(w, err)
		return
	}
	dir, err := s.userDirectory(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	refs := make([]workout.OwnerRef, 0, len(ids))
	for _, id := range ids {
		if ref, ok := dir[id]; ok {
			refs = append(refs, ref)
		}
	}
	writeJSON(w, status, sharesResponse{Visibility: sess.Visibility, SharedWith: refs})
}

func (s *Server) handleFeedSessionsPublic(w http.ResponseWriter, r *http.Request) {
	s.writeSessionFeed(w, r, s.plans.ListPublicSessions)
}

func (s *Server) handleFeedSessionsShared(w http.ResponseWriter, r *http.Request) {
	s.writeSessionFeed(w, r, s.plans.ListSharedSessionsWithMe)
}

func (s *Server) writeSessionFeed(w http.ResponseWriter, r *http.Request, load func(ctx context.Context, viewerID int64) ([]plans.Session, error)) {
	user := httpmw.UserFrom(r)
	list, err := load(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load sessions")
		return
	}
	dir, err := s.userDirectory(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	out := make([]plans.Session, 0, len(list))
	for i := range list {
		ref, ok := dir[list[i].UserID]
		if !ok {
			continue
		}
		list[i].Owner = &ref
		out = append(out, list[i])
	}
	writeJSON(w, http.StatusOK, out)
}
