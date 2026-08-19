package httpapi

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// Comments and reactions.
//
// Two conditions have to hold before any of this is reachable, and they are
// different questions with different answers:
//
//   - the caller may see the workout — GetViewable, the same check the gallery
//     and the route use;
//   - the workout is shared at all.
//
// The second is what makes a conversation a conversation. A private workout has
// no audience, so it has no comment thread; the tab is not offered and the
// endpoints refuse. For anybody other than the owner the second condition is
// implied by the first — they are looking at it, which is only possible because
// it is shared — so only the owner pays for the extra query.
//
// Unsharing hides; it does not delete. Nothing here removes a row when a
// workout goes private: the gate simply stops returning them, and re-sharing
// brings the thread back intact. Deleting on unshare would make a moment's
// mistake — flipping the toggle to check something — permanently destructive,
// and there is no undo anywhere near that switch.

// socialResponse is the whole tab in one request.
//
// One call rather than one per list: the tab shows reactions and comments
// together and is useless with half of them, so two requests would only add a
// state where the page is half drawn.
type socialResponse struct {
	// Shared says why the lists may be empty. Without it the client cannot
	// tell "nobody has said anything" from "this workout is private", and
	// those need different words on screen.
	Shared    bool               `json:"shared"`
	Reactions []workout.Reaction `json:"reactions"`
	Comments  []workout.Comment  `json:"comments"`
	Emojis    []string           `json:"emojis"`
	// MyReaction is what the caller picked, so the picker can show it as
	// chosen without the client having to find itself in the list.
	MyReaction string `json:"myReaction,omitempty"`
}

// socialContext is the result of the two checks above, resolved once.
//
// Subject-shaped rather than workout-shaped: comments and reactions now hang
// off a plan and a finished session too, and every handler below is the same
// code for all three once "may they see it, and is it shared" has an answer.
// Only that resolution differs per kind — see resolveSocial and its two
// siblings.
// socialResolver answers the two questions above for one kind of subject.
type socialResolver func(http.ResponseWriter, *http.Request) (socialContext, bool)

type socialContext struct {
	subject workout.Subject
	// Who owns the thing being talked about; they may moderate the thread.
	ownerID int64
	// What to call it in a notification, and where that notification points.
	name string
	link string
	// The noun for the "not shared" error, so it names the right thing.
	noun    string
	isOwner bool
	shared  bool
}

// resolveSocial establishes who is asking and whether there is anything to ask
// about. It writes the error response itself and returns ok=false, so every
// handler below starts with the same three lines and cannot forget half of it.
func (s *Server) resolveSocial(w http.ResponseWriter, r *http.Request) (socialContext, bool) {
	user := httpmw.UserFrom(r)
	wk, isOwner, err := s.workout.GetViewable(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return socialContext{}, false
	}
	// A viewer who is not the owner is proof of sharing all by themselves:
	// GetViewable only returned this workout because it is public or shared
	// with them. Skipping the query for them is not an optimisation, it is the
	// only correct answer — the shared-ness query is owner-scoped.
	shared := true
	if isOwner {
		shared, err = s.workout.IsShared(r.Context(), user.ID, wk.ID)
		if err != nil {
			slog.Error("could not check workout sharing", "workout_id", wk.ID, "error", err)
			writeError(w, http.StatusInternalServerError, "could not load comments")
			return socialContext{}, false
		}
	}
	return socialContext{
		subject: workout.WorkoutSubject(wk.ID),
		ownerID: wk.UserID,
		name:    wk.Name,
		link:    "/workouts/" + wk.ID + "?tab=social",
		noun:    "workout",
		isOwner: isOwner,
		shared:  shared,
	}, true
}

// resolvePlanSocial and resolveSessionSocial are the same two questions for
// the other two kinds. "Shared" is read straight off the item rather than
// through a second query: unlike a workout, a plan carries its own visibility
// and its share count is already on the row the owner just fetched.
func (s *Server) resolvePlanSocial(w http.ResponseWriter, r *http.Request) (socialContext, bool) {
	user := httpmw.UserFrom(r)
	p, isOwner, err := s.plans.GetViewablePlan(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writePlanError(w, err)
		return socialContext{}, false
	}
	// Anyone who is not the owner is looking at it *because* it is shared, so
	// the flag is theirs for free; only the owner pays for the check.
	shared := true
	if isOwner {
		shared = p.Visibility == workout.VisibilityPublic
		if !shared {
			if ids, err := s.plans.PlanShareRecipients(r.Context(), user.ID, p.ID); err == nil {
				shared = len(ids) > 0
			}
		}
	}
	return socialContext{
		subject: workout.PlanSubject(p.ID),
		ownerID: p.UserID,
		name:    p.Name,
		link:    "/discover/plan/" + p.ID + "?tab=social",
		noun:    "plan",
		isOwner: isOwner,
		shared:  shared,
	}, true
}

func (s *Server) resolveSessionSocial(w http.ResponseWriter, r *http.Request) (socialContext, bool) {
	user := httpmw.UserFrom(r)
	sess, isOwner, err := s.plans.GetViewableSession(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writePlanError(w, err)
		return socialContext{}, false
	}
	shared := true
	if isOwner {
		shared = sess.Visibility == workout.VisibilityPublic
		if !shared {
			if ids, err := s.plans.SessionShareRecipients(r.Context(), user.ID, sess.ID); err == nil {
				shared = len(ids) > 0
			}
		}
	}
	return socialContext{
		subject: workout.SessionSubject(sess.ID),
		ownerID: sess.UserID,
		name:    sess.DayName,
		link:    "/discover/session/" + sess.ID + "?tab=social",
		noun:    "session",
		isOwner: isOwner,
		shared:  shared,
	}, true
}

// handleGetSocial returns the reactions and comments on a workout.
func (s *Server) handleGetSocial(resolve socialResolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := httpmw.UserFrom(r)
		ctx, ok := resolve(w, r)
		if !ok {
			return
		}

		out := socialResponse{
			Shared:    ctx.shared,
			Reactions: []workout.Reaction{},
			Comments:  []workout.Comment{},
			Emojis:    workout.ReactionEmojis,
		}
		// A private workout answers with the empty tab rather than a 403: the
		// client asked a fair question and "there is nothing here, because it is
		// not shared" is the true answer to it.
		if !ctx.shared {
			writeJSON(w, http.StatusOK, out)
			return
		}

		reactions, err := s.workout.Reactions(r.Context(), ctx.subject)
		if err != nil {
			slog.Error("could not list reactions", "subject", ctx.subject.ID, "error", err)
			writeError(w, http.StatusInternalServerError, "could not load reactions")
			return
		}
		comments, err := s.workout.Comments(r.Context(), ctx.subject)
		if err != nil {
			slog.Error("could not list comments", "subject", ctx.subject.ID, "error", err)
			writeError(w, http.StatusInternalServerError, "could not load comments")
			return
		}

		dir, err := s.userDirectory(r)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not load users")
			return
		}
		// Rows naming a deleted account are dropped rather than rendered as an
		// unknown id, the same way share recipients are — see writeShares. The
		// purge normally gets there first; this is what covers the gap if it did
		// not, so a failed cleanup can never show as a ghost in a thread.
		for _, re := range reactions {
			ref, ok := dir[re.UserID]
			if !ok {
				continue
			}
			if re.UserID == user.ID {
				out.MyReaction = re.Emoji
			}
			re.Author = &ref
			out.Reactions = append(out.Reactions, re)
		}
		for _, c := range comments {
			ref, ok := dir[c.UserID]
			if !ok {
				continue
			}
			c.Author = &ref
			out.Comments = append(out.Comments, c)
		}
		writeJSON(w, http.StatusOK, out)
	}
}

type commentRequest struct {
	Body string `json:"body"`
}

// handleAddComment posts a message to a shared workout.
func (s *Server) handleAddComment(resolve socialResolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := httpmw.UserFrom(r)
		ctx, ok := resolve(w, r)
		if !ok {
			return
		}
		if !ctx.shared {
			writeError(w, http.StatusConflict, "this "+ctx.noun+" is not shared")
			return
		}
		var req commentRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		c, err := s.workout.AddComment(r.Context(), ctx.subject, user.ID, req.Body)
		if err != nil {
			s.writeWorkoutError(w, err)
			return
		}
		if ref, err := s.lookupUser(r, user.ID); err == nil && ref != nil {
			c.Author = ref
		}
		// After the comment is stored, so the author counts as a participant and a
		// reply reaches everyone already in the thread. No dedupe key: every
		// comment is a distinct thing somebody said.
		s.notifySocial(r, *user, ctx.subject, ctx.ownerID, ctx.link,
			actorName(*user)+" commented on a "+ctx.noun, excerpt(c.Body), "")
		writeJSON(w, http.StatusCreated, c)
	}
}

// handleEditComment rewrites a message the caller wrote. Only its author, and
// not the workout's owner: editing somebody's words under their name is a
// different thing entirely from removing them.
func (s *Server) handleEditComment(resolve socialResolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := httpmw.UserFrom(r)
		ctx, ok := resolve(w, r)
		if !ok {
			return
		}
		if !ctx.shared {
			writeError(w, http.StatusConflict, "this "+ctx.noun+" is not shared")
			return
		}
		var req commentRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		c, err := s.workout.EditComment(r.Context(), ctx.subject, r.PathValue("commentID"), user.ID, req.Body)
		if err != nil {
			s.writeSocialError(w, err)
			return
		}
		if ref, err := s.lookupUser(r, user.ID); err == nil && ref != nil {
			c.Author = ref
		}
		// An edit is told to the thread, because on a shared page it changes what
		// everyone else already read. Keyed on the comment, so correcting a typo
		// three times in a row is one notification rather than three — the thread
		// cares that the message changed, not how many passes it took.
		s.notifySocial(r, *user, ctx.subject, ctx.ownerID, ctx.link,
			actorName(*user)+" edited a comment", excerpt(c.Body), "social-edit:"+c.ID)
		writeJSON(w, http.StatusOK, c)
	}
}

// handleDeleteComment removes a message. Its author may always remove it, and
// the workout's owner may remove any of them — the one moderation control on a
// page they published.
func (s *Server) handleDeleteComment(resolve socialResolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := httpmw.UserFrom(r)
		ctx, ok := resolve(w, r)
		if !ok {
			return
		}
		// Deliberately not gated on `shared`: an owner who has just made a workout
		// private must still be able to clear a comment they did not want, and
		// refusing here would leave it there with no way to reach it.
		commentID := r.PathValue("commentID")
		// Read before it goes, so the notification can say whose message this was.
		// Best effort: a comment that cannot be read is still one that can be
		// deleted, and failing the delete over the notification would be backwards.
		gone, readErr := s.workout.Comment(r.Context(), ctx.subject, commentID)
		if err := s.workout.RemoveComment(r.Context(), ctx.subject, commentID, user.ID, ctx.isOwner); err != nil {
			s.writeSocialError(w, err)
			return
		}
		// Only when somebody else's was removed — a moderation decision the author
		// should hear about. Deleting your own is not news to anyone, least of all
		// to you, and announcing it to the thread would be a second copy of a
		// message that was just withdrawn, which is why the body is not included.
		if readErr == nil && gone.UserID != user.ID {
			s.notifySocial(r, *user, ctx.subject, ctx.ownerID, ctx.link,
				actorName(*user)+" removed a comment", ctx.name, "social-remove:"+commentID)
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type reactionRequest struct {
	Emoji string `json:"emoji"`
}

// handleSetReaction records the caller's single reaction, replacing any they
// had. An empty emoji clears it, so the picker's "tap the one you chose again"
// gesture is the same request.
func (s *Server) handleSetReaction(resolve socialResolver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user := httpmw.UserFrom(r)
		ctx, ok := resolve(w, r)
		if !ok {
			return
		}
		if !ctx.shared {
			writeError(w, http.StatusConflict, "this "+ctx.noun+" is not shared")
			return
		}
		var req reactionRequest
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		if req.Emoji == "" {
			if err := s.workout.ClearReaction(r.Context(), ctx.subject, user.ID); err != nil {
				s.writeWorkoutError(w, err)
				return
			}
		} else if err := s.workout.SetReaction(r.Context(), ctx.subject, user.ID, req.Emoji); err != nil {
			s.writeWorkoutError(w, err)
			return
		} else {
			// Keyed on the person and the workout, so switching emoji or tapping
			// twice tells everyone once. A reaction is a gesture, not a message;
			// hearing about each revision of one would be noise.
			s.notifySocial(r, *user, ctx.subject, ctx.ownerID, ctx.link,
				actorName(*user)+" reacted "+req.Emoji,
				ctx.name,
				fmt.Sprintf("social-reaction:%s:%d", ctx.subject.ID, user.ID))
		}
		// The whole tab back, so the client never has to merge a reaction into a
		// list it is also re-sorting — the counts and "who reacted" both change.
		s.handleGetSocial(resolve)(w, r)
	}
}

// writeSocialError maps the comment-specific errors and defers the rest.
func (s *Server) writeSocialError(w http.ResponseWriter, err error) {
	if errors.Is(err, workout.ErrCommentNotFound) {
		// One status for "no such comment" and "not yours", so a probe cannot
		// tell them apart by the code it gets back.
		writeError(w, http.StatusNotFound, "no such comment")
		return
	}
	s.writeWorkoutError(w, err)
}

// excerpt is a comment's opening, for a notification body.
//
// Cut on a rune boundary, not a byte one: half a character is a mojibake box in
// a push notification, on someone else's phone, where nothing can fix it.
func excerpt(body string) string {
	const limit = 120
	body = strings.Join(strings.Fields(body), " ")
	runes := []rune(body)
	if len(runes) <= limit {
		return body
	}
	return strings.TrimSpace(string(runes[:limit])) + "…"
}
