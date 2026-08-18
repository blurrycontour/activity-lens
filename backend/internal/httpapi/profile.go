package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/plans"
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

	for _, list := range [][]workout.Workout{mine, open, withThem} {
		s.annotateFlags(r.Context(), list)
	}

	// The same three relationships, for plans and finished sessions. Built by
	// the same helper for both kinds and both directions, because "theirs that
	// I can see" and "mine that they can see" are one question asked twice.
	pl := s.profilePlans(r, viewer.ID, id, ref)

	prefs, err := s.settings.UserPreferences(r.Context(), id)
	if err != nil {
		// A missing tagline is not worth failing a profile for.
		prefs = settings.UserPrefs{}
	}

	// What the ping row needs to draw itself: the messages this server offers,
	// and how long is left of the cooldown between these two people. Sent with
	// the profile rather than fetched separately because it is only ever wanted
	// here, and a second round trip would leave the row briefly undrawable.
	cooldown := s.pingCooldown(r)
	writeJSON(w, http.StatusOK, map[string]any{
		"user":    ref,
		"tagline": prefs.Tagline,
		"ping": map[string]any{
			"messages":        pingMessages,
			"cooldownSeconds": int(cooldown / time.Second),
			"waitSeconds":     int(s.pings.wait(viewer.ID, id, cooldown, time.Now()).Round(time.Second) / time.Second),
		},
		// Theirs, sent to you directly.
		"sharedWithMe": mine,
		// Theirs, open to everyone signed in here.
		"publicWorkouts": open,
		// Yours, sent to them. The only list here that reads the caller's own
		// library, and the reason it is owner-scoped rather than filtered.
		"sharedWithThem": withThem,

		"sharedPlansWithMe":      pl.plansWithMe,
		"publicPlans":            pl.publicPlans,
		"plansSharedWithThem":    pl.plansWithThem,
		"sharedSessionsWithMe":   pl.sessionsWithMe,
		"publicSessions":         pl.publicSessions,
		"sessionsSharedWithThem": pl.sessionsWithThem,
	})
}

// profileLists is the plan and session half of a profile: the same three
// relationships the workout lists above answer, for the other two kinds.
type profileLists struct {
	plansWithMe      []plans.Plan
	publicPlans      []plans.Plan
	plansWithThem    []plans.Plan
	sessionsWithMe   []plans.Session
	publicSessions   []plans.Session
	sessionsWithThem []plans.Session
}

// profilePlans fills profileLists for somebody else's profile.
//
// Every list is empty rather than absent on failure, and nothing here fails
// the request: a profile whose workouts loaded but whose plans did not is
// still worth drawing, and the alternative is that a plans service being off
// (see withPlans) takes down every profile page on the instance.
func (s *Server) profilePlans(r *http.Request, viewerID, ownerID int64, ref *workout.OwnerRef) profileLists {
	out := profileLists{
		plansWithMe: []plans.Plan{}, publicPlans: []plans.Plan{}, plansWithThem: []plans.Plan{},
		sessionsWithMe: []plans.Session{}, publicSessions: []plans.Session{}, sessionsWithThem: []plans.Session{},
	}
	if s.plans == nil {
		return out
	}
	ctx := r.Context()

	// Theirs, sent to you, then theirs that is open to everyone — filtered to
	// this person, since both feeds span the whole instance. A plan that is
	// both shared and public belongs to the shared list: that is the stronger
	// relationship, and the one the reader would rather know about.
	seenPlans := map[string]struct{}{}
	if list, err := s.plans.ListSharedPlansWithMe(ctx, viewerID); err == nil {
		for i := range list {
			if list[i].UserID != ownerID {
				continue
			}
			seenPlans[list[i].ID] = struct{}{}
			p := list[i]
			p.Owner = ref
			out.plansWithMe = append(out.plansWithMe, p)
		}
	} else {
		slog.Warn("could not load plans shared with viewer", "user_id", ownerID, "error", err)
	}
	if list, err := s.plans.ListPublicPlans(ctx, viewerID); err == nil {
		for i := range list {
			if list[i].UserID != ownerID {
				continue
			}
			if _, dup := seenPlans[list[i].ID]; dup {
				continue
			}
			p := list[i]
			p.Owner = ref
			out.publicPlans = append(out.publicPlans, p)
		}
	}

	seenSessions := map[string]struct{}{}
	if list, err := s.plans.ListSharedSessionsWithMe(ctx, viewerID); err == nil {
		for i := range list {
			if list[i].UserID != ownerID {
				continue
			}
			seenSessions[list[i].ID] = struct{}{}
			sess := list[i]
			sess.Owner = ref
			out.sessionsWithMe = append(out.sessionsWithMe, sess)
		}
	}
	if list, err := s.plans.ListPublicSessions(ctx, viewerID); err == nil {
		for i := range list {
			if list[i].UserID != ownerID {
				continue
			}
			if _, dup := seenSessions[list[i].ID]; dup {
				continue
			}
			sess := list[i]
			sess.Owner = ref
			out.publicSessions = append(out.publicSessions, sess)
		}
	}

	// Yours, sent to them. Owner-scoped, so the id narrows and grants nothing.
	if list, err := s.plans.ListPlansSharedByMeWith(ctx, viewerID, ownerID); err == nil {
		out.plansWithThem = list
	}
	if list, err := s.plans.ListSessionsSharedByMeWith(ctx, viewerID, ownerID); err == nil {
		out.sessionsWithThem = list
	}
	return out
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
		// Deliberately no Owner: the field means "belongs to someone else", and
		// setting it on your own rows made the workout page open them as a
		// guest — "Shared by <you>" above your own workout, until the full
		// fetch arrived and took it away again.
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
	for _, list := range [][]workout.Workout{out, sent} {
		s.annotateFlags(r.Context(), list)
	}

	own := s.ownProfilePlans(r, ref.ID)

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

		"sharedPlansWithMe":      []plans.Plan{},
		"publicPlans":            own.publicPlans,
		"plansSharedWithThem":    own.plansWithThem,
		"sharedSessionsWithMe":   []plans.Session{},
		"publicSessions":         own.publicSessions,
		"sessionsSharedWithThem": own.sessionsWithThem,
	})
}

// ownProfilePlans is the plan and session half of your *own* profile.
//
// A separate path from profilePlans for the same reason writeOwnProfile is:
// the feeds deliberately exclude your own rows, so the only way to answer
// "what of mine can other people see" is from your own library, filtered by
// the visibility that is yours to read.
func (s *Server) ownProfilePlans(r *http.Request, ownerID int64) profileLists {
	out := profileLists{
		publicPlans: []plans.Plan{}, plansWithThem: []plans.Plan{},
		publicSessions: []plans.Session{}, sessionsWithThem: []plans.Session{},
	}
	if s.plans == nil {
		return out
	}
	ctx := r.Context()
	dir, err := s.userDirectory(r)
	if err != nil {
		dir = map[int64]workout.OwnerRef{}
	}

	// One grouped query per kind rather than a lookup per row, the same way
	// the workout half above annotates itself.
	planCounts, _ := s.plans.PlanShareCounts(ctx, ownerID)
	planTo, _ := s.plans.PlanShareRecipientsByPlan(ctx, ownerID)
	if list, err := s.plans.ListPlans(ctx, ownerID); err == nil {
		for i := range list {
			p := list[i]
			// Deliberately no Owner: the field means "belongs to someone
			// else", and setting it on your own rows opens them as a guest.
			p.SharedWithCount = planCounts[p.ID]
			if p.Visibility == workout.VisibilityPublic {
				out.publicPlans = append(out.publicPlans, p)
			}
			// Sent to named people, which is a different act from making
			// something public: a plan can be both, and belongs in both.
			if p.SharedWithCount > 0 {
				p.SharedWith = namesFor(planTo[p.ID], dir)
				out.plansWithThem = append(out.plansWithThem, p)
			}
		}
	} else {
		slog.Warn("could not load own plans for profile", "user_id", ownerID, "error", err)
	}

	sessionCounts, _ := s.plans.SessionShareCounts(ctx, ownerID)
	sessionTo, _ := s.plans.SessionShareRecipientsBySession(ctx, ownerID)
	if list, err := s.plans.ListSessions(ctx, ownerID, plans.MaxSessionsPerListed, 0); err == nil {
		for i := range list {
			sess := list[i]
			sess.SharedWithCount = sessionCounts[sess.ID]
			if sess.Visibility == workout.VisibilityPublic {
				out.publicSessions = append(out.publicSessions, sess)
			}
			if sess.SharedWithCount > 0 {
				sess.SharedWith = namesFor(sessionTo[sess.ID], dir)
				out.sessionsWithThem = append(out.sessionsWithThem, sess)
			}
		}
	}
	return out
}

// namesFor resolves share recipients, in the order they were shared with. An
// account deleted since is simply absent — the share row goes with the user,
// and a name we cannot resolve is not one worth inventing.
func namesFor(ids []int64, dir map[int64]workout.OwnerRef) []workout.OwnerRef {
	out := make([]workout.OwnerRef, 0, len(ids))
	for _, id := range ids {
		if who, ok := dir[id]; ok {
			out = append(out, who)
		}
	}
	return out
}
