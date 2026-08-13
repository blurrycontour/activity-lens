package httpapi

import (
	"net/http"
	"strconv"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
	"github.com/blurrycontour/go-authkit/httpmw"
)

// handleUserProfile answers with another person and the workouts of theirs you
// can see.
//
// "Can see" is the whole security model of this endpoint, and it is not
// computed here: the list is the intersection of what they have made visible to
// you — public, or shared with you directly — filtered out of the two feeds the
// app already builds. Nothing is queried by owner id, so there is no path by
// which a guessed id returns a workout that was not already yours to read.
//
// It follows that a profile for someone who has shared nothing is an empty
// list rather than a 404. The account exists and is a real member of this
// instance; that they have shared nothing with you is the answer, not an error.
func (s *Server) handleUserProfile(w http.ResponseWriter, r *http.Request) {
	viewer := httpmw.UserFrom(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	// Your own profile is not a thing to render here — the app has a whole
	// library for that — and answering it would mean a second, weaker view of
	// your own workouts.
	if id == viewer.ID {
		writeError(w, http.StatusBadRequest, "that is you")
		return
	}

	ref, err := s.lookupUser(r, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	if ref == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	// Both feeds, because "shared with me" and "public" are different reasons
	// to be able to see a workout and a profile should show either.
	shared, err := s.workout.ListSharedWithMe(r.Context(), viewer.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load workouts")
		return
	}
	public, err := s.workout.ListPublic(r.Context(), viewer.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load workouts")
		return
	}

	seen := map[string]struct{}{}
	out := make([]workout.Workout, 0)
	counts := [2]int{}
	// Which feed a workout came from, not what its Visibility field says: that
	// field is redacted on someone else's workout — it is the owner's sharing
	// state, not a fact about you — so reading it here counted every public
	// workout as one shared with you personally.
	//
	// Shared is scanned first, so a workout that is both public and shared with
	// you directly counts as shared: that is the stronger relationship, and the
	// one the reader would rather know about.
	for feed, list := range [][]workout.Workout{shared, public} {
		for i := range list {
			if list[i].UserID != id {
				continue
			}
			if _, dup := seen[list[i].ID]; dup {
				continue
			}
			seen[list[i].ID] = struct{}{}
			counts[feed]++
			wk := list[i]
			wk.Owner = ref
			out = append(out, wk)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user": ref,
		// Split, because the two mean different things to the person reading:
		// one is "they chose to send this to me", the other "this is open to
		// everyone here".
		"sharedWithMe": counts[0],
		"public":       counts[1],
		"workouts":     out,
	})
}
