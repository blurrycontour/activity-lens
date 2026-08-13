package httpapi

import (
	"net/http"
	"strconv"

	"github.com/blurrycontour/activity-lens/backend/internal/settings"
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

	ref, err := s.lookupUser(r, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	if ref == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	// Your own profile is what other people see of you, so it is only ever the
	// public half: "shared with me" and "shared with them" are both relations
	// between two people, and neither means anything pointed at yourself.
	if id == viewer.ID {
		s.writeOwnProfile(w, r, *ref)
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

	// The third answer a profile needs, and the only one that reads the
	// caller's own library: what have *I* sent *them*. Owner-scoped, so the id
	// narrows the query and grants nothing.
	withThem, err := s.workout.ListSharedByMeWith(r.Context(), viewer.ID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load workouts")
		return
	}

	// Three lists rather than one merged one with counts beside it.
	//
	// The merged form made the client reconstruct which rows were which by
	// slicing on a count, which is only correct while the server happens to
	// append in that order — a silent, ordering-dependent coupling between two
	// codebases. Naming each list says the same thing and cannot drift.
	//
	// A workout that is both public and shared with you directly belongs to the
	// shared list: that is the stronger relationship, and the one the reader
	// would rather know about.
	shareIDs := map[string]struct{}{}
	mine := make([]workout.Workout, 0)
	for i := range shared {
		if shared[i].UserID != id {
			continue
		}
		shareIDs[shared[i].ID] = struct{}{}
		wk := shared[i]
		wk.Owner = ref
		mine = append(mine, wk)
	}
	open := make([]workout.Workout, 0)
	for i := range public {
		if public[i].UserID != id {
			continue
		}
		if _, dup := shareIDs[public[i].ID]; dup {
			continue
		}
		wk := public[i]
		wk.Owner = ref
		open = append(open, wk)
	}

	prefs, err := s.settings.UserPreferences(r.Context(), id)
	if err != nil {
		// A missing tagline is not worth failing a profile for.
		prefs = settings.UserPrefs{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"user":    ref,
		"tagline": prefs.Tagline,
		// Theirs, sent to you directly.
		"sharedWithMe": mine,
		// Theirs, open to everyone signed in here.
		"publicWorkouts": open,
		// Yours, sent to them. The only list here that reads the caller's own
		// library, and the reason it is owner-scoped rather than filtered.
		"sharedWithThem": withThem,
	})
}

// writeOwnProfile answers /api/users/{me} with the public face of your own
// account: the workouts anyone signed in here can already see.
//
// A separate path because the feeds deliberately exclude your own rows — they
// exist to show you other people — so the only way to answer this is from your
// own library, filtered by the visibility that is yours to read.
func (s *Server) writeOwnProfile(w http.ResponseWriter, r *http.Request, ref workout.OwnerRef) {
	list, err := s.workout.List(r.Context(), ref.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load workouts")
		return
	}
	out := make([]workout.Workout, 0)
	for i := range list {
		if list[i].Visibility == workout.VisibilityPublic {
			wk := list[i]
			wk.Owner = &ref
			out = append(out, wk)
		}
	}
	prefs, err := s.settings.UserPreferences(r.Context(), ref.ID)
	if err != nil {
		prefs = settings.UserPrefs{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":    ref,
		"tagline": prefs.Tagline,
		"self":    true,
		// Your own profile is only ever the public half: the other two lists
		// are relations between two people.
		"sharedWithMe":   []workout.Workout{},
		"publicWorkouts": out,
		"sharedWithThem": []workout.Workout{},
	})
}
