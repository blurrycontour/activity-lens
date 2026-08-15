package httpapi

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/sessions"
	"github.com/blurrycontour/go-authkit/httpmw"
)

// ClientHeader is how a client names itself: "<kind>/<version>", as in
// "web/1.11.1" or "android/1.11.1".
//
// A user agent cannot carry either fact. The Android app runs a WebView, so its
// agent is a Chrome agent with a "wv" in it — indistinguishable from a browser
// on the same phone in any way worth betting a revoke button on — and no agent
// anywhere says which build of this app is talking.
const ClientHeader = "X-Activity-Lens-Client"

// seenInterval is how often one session's row is touched. A write per request
// would put a row update behind every read on a database with one writer, to
// record a number nobody reads at that resolution: what "last active" is for is
// telling a phone used this morning from one signed into in March.
const seenInterval = 5 * time.Minute

// sessionTracker throttles those writes in memory.
//
// The map is bounded by the number of live sessions, which is the number of
// devices the people using this instance are signed in on — tens, not
// thousands. Entries for revoked sessions linger until the next sweep, which
// costs one stale timestamp each and nothing else.
type sessionTracker struct {
	mu   sync.Mutex
	seen map[string]time.Time
}

func newSessionTracker() *sessionTracker {
	return &sessionTracker{seen: make(map[string]time.Time)}
}

// due reports whether this session is ready to be written again, and records
// the intent. Deliberately marks before the write rather than after: two
// concurrent requests on one session should produce one write, and a failed
// write is not worth retrying on the very next request.
func (t *sessionTracker) due(sessionID string, now time.Time) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if last, ok := t.seen[sessionID]; ok && now.Sub(last) < seenInterval {
		return false
	}
	t.seen[sessionID] = now
	return true
}

// forget drops a session, so signing back in on the same device records
// immediately rather than waiting out the interval.
func (t *sessionTracker) forget(sessionID string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	delete(t.seen, sessionID)
}

// sweep drops entries not touched in a while, so a long-running server does not
// hold a timestamp for every session it has ever seen.
func (t *sessionTracker) sweep(now time.Time) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for id, at := range t.seen {
		if now.Sub(at) > 24*time.Hour {
			delete(t.seen, id)
		}
	}
}

// withSessionTracking notes which client a session belongs to and when it was
// last used.
//
// Wrapped inside RequireAuth, and so also inside withBearerSession, which is
// what makes it see the native app: that middleware promotes the Authorization
// token into the cookie the rest of the stack reads, so by here a phone and a
// browser both have a session id and are told apart by the header rather than
// by how they authenticated.
//
// Failures are logged and swallowed. This is bookkeeping, and refusing
// someone's workouts because a device list could not be updated would be the
// wrong trade.
func (s *Server) withSessionTracking(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)

		if s.sessionClients == nil {
			return
		}
		user := httpmw.UserFrom(r)
		sid := s.mw.SessionID(r)
		if user == nil || sid == "" {
			// Nothing to attribute this to.
			return
		}
		if !s.sessionSeen.due(sid, time.Now()) {
			return
		}
		// The request's own context is cancelled the moment the response is
		// written, which is exactly when this runs.
		ctx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
		defer cancel()
		c := sessions.ParseClientHeader(r.Header.Get(ClientHeader))
		if err := s.sessionClients.Record(ctx, sid, user.ID, c); err != nil {
			slog.Warn("could not record session client", "user_id", user.ID, "error", err)
		}
	})
}

// RecordSessionClient stamps a session at login, so a device appears in the
// list with its kind and version straight away rather than after its first
// throttled request.
func (s *Server) RecordSessionClient(r *http.Request, sessionID string, userID int64) {
	if s.sessionClients == nil || sessionID == "" {
		return
	}
	s.sessionSeen.forget(sessionID)
	s.sessionSeen.due(sessionID, time.Now())
	c := sessions.ParseClientHeader(r.Header.Get(ClientHeader))
	if err := s.sessionClients.Record(r.Context(), sessionID, userID, c); err != nil {
		slog.Warn("could not record session client at login", "user_id", userID, "error", err)
	}
}
