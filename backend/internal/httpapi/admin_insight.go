package httpapi

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/blurrycontour/activity-lens/backend/internal/notify"
	"github.com/blurrycontour/go-authkit/httpmw"
)

// handleGetAdminUser answers with everything the admin screen shows about one
// account: the user, what they have accumulated, and the devices they are
// signed in on.
//
// One endpoint rather than three because all of it is one screen, and three
// round trips to render a page is three chances to show it half-populated.
func (s *Server) handleGetAdminUser(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	users, err := s.auth.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	idx := -1
	for i := range users {
		if users[i].ID == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	// The admin is looking at someone else's devices, so no session here is
	// "current" — passing an empty id is what says that, rather than marking
	// whichever session happens to be the admin's own.
	list, err := s.auth.ListSessions(r.Context(), id, "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load sessions")
		return
	}

	stats := &UserStats{}
	if s.adminStats != nil {
		if all, err := s.adminStats.All(r.Context()); err != nil {
			slog.Warn("could not load user stats", "user_id", id, "error", err)
		} else if got, ok := all[id]; ok {
			stats = got
		}
	}

	last, err := s.settings.LastLogins(r.Context())
	if err != nil {
		slog.Warn("could not load login history", "error", err)
		last = map[int64]string{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		// Sessions is redundant beside the list below, but a row that says zero
		// while two are listed under it is wrong rather than merely repetitive.
		"user":     adminUser{User: users[idx], LastLoginAt: last[id], Sessions: len(list)},
		"stats":    stats,
		"sessions": s.describeSessions(r.Context(), list),
	})
}

// handleRevokeUserSession signs one of another user's devices out.
//
// Scoped to the named user, so an admin cannot revoke a session by guessing a
// public id alone — the id has to belong to the account they are looking at.
// Nothing stops an admin revoking their own session this way, which is fine:
// they asked, and the effect is the same as signing out.
func (s *Server) handleRevokeUserSession(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	// No "except" session: an admin revoking a device means that device, and
	// excluding their own current session would silently no-op when an admin
	// revokes their own.
	ok, err := s.auth.RevokeSession(r.Context(), id, r.PathValue("sessionId"), "")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not revoke session")
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "session not found")
		return
	}
	actor := httpmw.UserFrom(r)
	slog.Info("admin revoked session", "admin", actor.Username, "user_id", id, "session", r.PathValue("sessionId"))
	w.WriteHeader(http.StatusNoContent)
}

// Broadcast bounds. A notification is a title and a line or two in a list, not
// a mail-out; anything longer is being sent through the wrong channel.
const (
	maxBroadcastTitle = 120
	maxBroadcastBody  = 1000
)

// handleBroadcast sends one message to everyone on this instance.
//
// Fanned out as an ordinary notification per user rather than stored once as an
// announcement with per-user read markers. That is the right trade at this
// scale — a handful of accounts — and it means the message arrives through
// everything that already exists: the bell, the unread count, push, per-user
// read and delete. An announcements table would have been a second notion of
// "message" with its own UI, its own read state and its own push path.
//
// The sender is excluded. An admin who has just typed a message does not need
// to be told about it, and seeing it appear in your own bell reads like it
// failed and echoed.
func (s *Server) handleBroadcast(w http.ResponseWriter, r *http.Request) {
	actor := httpmw.UserFrom(r)
	var req struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		// IncludeInactive sends to disabled accounts too. Off by default:
		// someone who cannot sign in cannot read it, so it would only ever
		// accumulate unread rows against an account nobody uses.
		IncludeInactive bool `json:"includeInactive"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	title := strings.TrimSpace(req.Title)
	body := strings.TrimSpace(req.Body)
	if title == "" {
		writeError(w, http.StatusBadRequest, "a message needs a title")
		return
	}
	if utf8.RuneCountInString(title) > maxBroadcastTitle {
		writeError(w, http.StatusBadRequest, "title is too long")
		return
	}
	if utf8.RuneCountInString(body) > maxBroadcastBody {
		writeError(w, http.StatusBadRequest, "message is too long")
		return
	}

	users, err := s.auth.ListUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}

	sent := 0
	for _, u := range users {
		if u.ID == actor.ID {
			continue
		}
		if !u.IsActive && !req.IncludeInactive {
			continue
		}
		// No dedupe key: two broadcasts with the same words are two messages,
		// and an admin repeating themselves is usually doing it on purpose.
		s.notify.Notify(r.Context(), notify.Event{
			UserID: u.ID,
			Kind:   notify.KindBroadcast,
			Title:  title,
			Body:   body,
			Icon:   actor.AvatarPath,
		})
		sent++
	}
	slog.Info("broadcast", "admin", actor.Username, "recipients", sent, "title", title)
	writeJSON(w, http.StatusOK, map[string]any{"sent": sent})
}
