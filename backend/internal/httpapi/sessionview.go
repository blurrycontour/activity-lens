package httpapi

import (
	"context"
	"log/slog"

	"github.com/blurrycontour/activity-lens/backend/internal/sessions"
	"github.com/blurrycontour/go-authkit/auth"
)

// sessionView is a signed-in device, described well enough to decide whether to
// revoke it.
//
// go-authkit's own SessionInfo carries the raw user agent and nothing else,
// which is a string like "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36
// (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36" — technically complete
// and useless at a glance. This adds the readable version of that, plus the two
// things the agent cannot say: which client it is and what version it runs.
//
// userAgent is still sent. It is the ground truth behind every derived field
// here, and when the parse comes back empty it is the only thing to show.
type sessionView struct {
	ID        string `json:"id"`
	IP        string `json:"ip"`
	CreatedAt string `json:"createdAt"`
	ExpiresAt string `json:"expiresAt"`
	Current   bool   `json:"current"`
	UserAgent string `json:"userAgent"`

	// Browser and Platform are read off the agent, and are empty when it says
	// nothing recognisable rather than being guessed at.
	Browser  string `json:"browser,omitempty"`
	Platform string `json:"platform,omitempty"`
	Mobile   bool   `json:"mobile,omitempty"`

	// Kind is "web" or "android", as declared by the client itself. Empty for a
	// session that predates the tracking, which the UI says plainly rather than
	// assuming a browser.
	Kind       string `json:"kind,omitempty"`
	AppVersion string `json:"appVersion,omitempty"`
	// LastSeen is the most recent request on this session, to within a few
	// minutes. Empty until the session makes one.
	LastSeen string `json:"lastSeen,omitempty"`
}

// describeSessions turns go-authkit's session list into something renderable,
// folding in whatever this app knows about each one.
//
// A failure to load the client rows is logged and dropped rather than returned:
// the session list is the security-relevant part and must render regardless.
// Losing the decoration costs a nicer label; losing the list costs someone the
// ability to see and revoke a device.
func (s *Server) describeSessions(ctx context.Context, list []auth.SessionInfo) []sessionView {
	clients := map[string]sessions.Client{}
	if s.sessionClients != nil && len(list) > 0 {
		ids := make([]string, 0, len(list))
		for _, si := range list {
			ids = append(ids, si.TokenID)
		}
		found, err := s.sessionClients.ForSessions(ctx, ids)
		if err != nil {
			slog.Warn("could not load session clients", "error", err)
		} else {
			clients = found
		}
	}

	out := make([]sessionView, 0, len(list))
	for _, si := range list {
		a := sessions.ParseAgent(si.UserAgent)
		c := clients[si.TokenID]
		out = append(out, sessionView{
			ID:         si.PublicID,
			IP:         si.IP,
			CreatedAt:  si.CreatedAt,
			ExpiresAt:  si.ExpiresAt,
			Current:    si.Current,
			UserAgent:  si.UserAgent,
			Browser:    a.Browser,
			Platform:   a.Platform,
			Mobile:     a.Mobile,
			Kind:       c.Kind,
			AppVersion: c.AppVersion,
			LastSeen:   c.LastSeen,
		})
	}
	return out
}

// sessionCounts is how many live sessions each user has.
//
// go-authkit exposes sessions per user and has no aggregate, so this asks once
// per account. That is a query per user, which is exactly the shape worth
// avoiding on a list — and is the right call anyway here: the alternative is
// reaching into another module's table behind its back, and this list is every
// account on a personal instance, not a page of a directory.
func (s *Server) sessionCounts(ctx context.Context, users []auth.User) (map[int64]int, error) {
	out := make(map[int64]int, len(users))
	for _, u := range users {
		list, err := s.auth.ListSessions(ctx, u.ID, "")
		if err != nil {
			return out, err
		}
		out[u.ID] = len(list)
	}
	return out, nil
}
