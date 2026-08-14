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
	list, err := s.workout.ListSummary(r.Context(), ref.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load workouts")
		return
	}
	// One grouped query for the whole library rather than a lookup per row,
	// the same way the library list annotates itself.
	counts, err := s.workout.ShareCounts(r.Context(), ref.ID)
	if err != nil {
		// Without counts the sent-to-someone list would silently look empty,
		// which is worse than saying the profile could not be built.
		writeError(w, http.StatusInternalServerError, "could not load shares")
		return
	}
	// Who each one went to, so the list can name them rather than counting
	// them. One query for the library, and one directory lookup, rather than a
	// pair per row.
	recipients, err := s.workout.ShareRecipientsByWorkout(r.Context(), ref.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load shares")
		return
	}
	dir, err := s.userDirectory(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	out := make([]workout.Workout, 0)
	sent := make([]workout.Workout, 0)
	for i := range list {
		wk := list[i]
		wk.Owner = &ref
		wk.SharedWithCount = counts[wk.ID]
		if wk.Visibility == workout.VisibilityPublic {
			out = append(out, wk)
		}
		// Sent to named people, which is a different act from making something
		// public: one is "these three can see it", the other is "everyone
		// signed in here can". A workout can be both, and belongs in both.
		if wk.SharedWithCount > 0 {
			// Named, in the order they were shared with. An account deleted
			// since is simply absent — the share row goes with the user, and a
			// name we cannot resolve is not one worth inventing.
			for _, id := range recipients[wk.ID] {
				if who, ok := dir[id]; ok {
					wk.SharedWith = append(wk.SharedWith, who)
				}
			}
			sent = append(sent, wk)
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
		// Nothing is shared *with* you by yourself, so that list stays empty.
		"sharedWithMe":   []workout.Workout{},
		"publicWorkouts": out,
		// Your own profile reads the same way round as anyone else's: this is
		// "yours, sent to them" with "them" being everyone you have shared
		// with — the outbound half that was previously only reachable as a
		// toggle buried in the library's filters.
		"sharedWithThem": sent,
	})
}
