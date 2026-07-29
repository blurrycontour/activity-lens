package httpapi

import (
	"context"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/auth"
	"github.com/blurrycontour/go-authkit/httpmw"
)

// Sharing endpoints. Owner names for feed rows are resolved here rather than
// with a SQL join: go-authkit owns the users table and the store package is
// deliberately kept free of its schema so auth could move to its own database.
// One directory lookup per request beats a per-row fan-out at any realistic
// instance size.

// directoryLimit caps how many users the share picker returns per query.
const (
	directoryDefaultLimit = 20
	directoryMaxLimit     = 50
)

// sharesResponse is the owner's view of one workout's sharing state.
type sharesResponse struct {
	Visibility workout.Visibility `json:"visibility"`
	SharedWith []workout.OwnerRef `json:"sharedWith"`
}

func (s *Server) handleListWorkoutShares(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	s.writeShares(w, r, user.ID, r.PathValue("id"), http.StatusOK)
}

type setVisibilityRequest struct {
	Visibility string `json:"visibility"`
}

func (s *Server) handleSetWorkoutVisibility(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req setVisibilityRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id := r.PathValue("id")
	if err := s.workout.SetVisibility(r.Context(), user.ID, id, workout.Visibility(req.Visibility)); err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	s.writeShares(w, r, user.ID, id, http.StatusOK)
}

type addShareRequest struct {
	UserID int64 `json:"userId"`
}

func (s *Server) handleAddWorkoutShare(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req addShareRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Resolve the target against the directory first: workout_shares has no
	// foreign key to the users table, so nothing else would catch a bad id.
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
	if err := s.workout.AddShare(r.Context(), user.ID, id, req.UserID); err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	if wk, err := s.workout.Get(r.Context(), user.ID, id); err == nil {
		s.notifyWorkoutShared(r, *user, req.UserID, wk)
	}
	s.writeShares(w, r, user.ID, id, http.StatusCreated)
}

func (s *Server) handleRemoveWorkoutShare(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	targetID, err := strconv.ParseInt(r.PathValue("userId"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if err := s.workout.RemoveShare(r.Context(), user.ID, r.PathValue("id"), targetID); err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// writeShares emits the current sharing state of a workout the caller owns. It
// is the response body for every owner-facing sharing endpoint so the client
// never has to re-fetch after a change.
func (s *Server) writeShares(w http.ResponseWriter, r *http.Request, ownerID int64, workoutID string, status int) {
	wk, err := s.workout.Get(r.Context(), ownerID, workoutID)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	ids, err := s.workout.ShareRecipients(r.Context(), ownerID, workoutID)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	dir, err := s.userDirectory(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	// Share rows naming a deleted account are dropped rather than rendered as
	// an unknown id — see the migration note on the missing foreign key.
	refs := make([]workout.OwnerRef, 0, len(ids))
	for _, id := range ids {
		if ref, ok := dir[id]; ok {
			refs = append(refs, ref)
		}
	}
	writeJSON(w, status, sharesResponse{Visibility: wk.Visibility, SharedWith: refs})
}

func (s *Server) handleFeedPublic(w http.ResponseWriter, r *http.Request) {
	s.writeFeed(w, r, s.workout.ListPublic)
}

func (s *Server) handleFeedShared(w http.ResponseWriter, r *http.Request) {
	s.writeFeed(w, r, s.workout.ListSharedWithMe)
}

// writeFeed renders a list of other people's workouts with their owners
// attached. The service has already redacted every row.
func (s *Server) writeFeed(w http.ResponseWriter, r *http.Request, load func(ctx context.Context, viewerID int64) ([]workout.Workout, error)) {
	user := httpmw.UserFrom(r)
	list, err := load(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load workouts")
		return
	}
	dir, err := s.userDirectory(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	out := make([]workout.Workout, 0, len(list))
	for i := range list {
		ref, ok := dir[list[i].UserID]
		if !ok {
			// The author's account is gone; showing an ownerless workout in a
			// feed would be confusing, so it is simply omitted.
			continue
		}
		list[i].Owner = &ref
		out = append(out, list[i])
	}
	writeJSON(w, http.StatusOK, out)
}

// handleListUserDirectory backs the share picker. Unlike GET /api/admin/users
// it is open to any signed-in user, so it projects only what a picker needs and
// never exposes email addresses, roles or activity status.
func (s *Server) handleListUserDirectory(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	users, err := s.auth.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	limit := directoryDefaultLimit
	if v, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && v > 0 {
		limit = min(v, directoryMaxLimit)
	}

	out := make([]workout.OwnerRef, 0, limit)
	for _, u := range users {
		if u.ID == user.ID || !u.IsActive {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(u.Username), q) &&
			!strings.Contains(strings.ToLower(u.DisplayName), q) {
			continue
		}
		out = append(out, userRef(u))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Username < out[j].Username })
	if len(out) > limit {
		out = out[:limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{"users": out})
}

// userDirectory indexes every user by id in one lookup, so rendering a feed or
// a recipient list never queries per row.
func (s *Server) userDirectory(r *http.Request) (map[int64]workout.OwnerRef, error) {
	users, err := s.auth.ListUsers(r.Context())
	if err != nil {
		return nil, err
	}
	dir := make(map[int64]workout.OwnerRef, len(users))
	for _, u := range users {
		dir[u.ID] = userRef(u)
	}
	return dir, nil
}

// ownerRef resolves a single user id for a detail response. It returns nil when
// the account no longer exists, which the caller renders as an unattributed
// workout rather than failing the request.
func (s *Server) ownerRef(r *http.Request, id int64) (*workout.OwnerRef, error) {
	dir, err := s.userDirectory(r)
	if err != nil {
		return nil, err
	}
	if ref, ok := dir[id]; ok {
		return &ref, nil
	}
	return nil, nil
}

// lookupUser returns the directory entry for id, or nil when no active user has
// it. Inactive accounts are treated as absent: they cannot sign in, so sharing
// with one would be a silent no-op.
func (s *Server) lookupUser(r *http.Request, id int64) (*workout.OwnerRef, error) {
	users, err := s.auth.ListUsers(r.Context())
	if err != nil {
		return nil, err
	}
	for _, u := range users {
		if u.ID == id && u.IsActive {
			ref := userRef(u)
			return &ref, nil
		}
	}
	return nil, nil
}

func userRef(u auth.User) workout.OwnerRef {
	return workout.OwnerRef{
		ID:          u.ID,
		Username:    u.Username,
		DisplayName: u.DisplayName,
		AvatarPath:  effectiveAvatar(u),
	}
}
