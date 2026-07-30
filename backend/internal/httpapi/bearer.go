package httpapi

import (
	"context"
	"net/http"
	"strings"
)

// Authentication for the native app, which cannot use cookies.
//
// The web app is same-origin and authenticates with an httpOnly session cookie.
// The Android app is a WebView on its own origin talking to whatever server the
// user pointed it at, so nothing it sends is same-origin and a cookie would be
// third-party — blocked by default on modern Android WebViews, and a moving
// target besides. It sends `Authorization: Bearer <session token>` instead.
//
// The token is a *session* token, the same value the cookie would have carried.
// That is the whole trick, and it is deliberate: no second kind of credential
// exists, so there is no second issuing path, expiry rule, revocation path or
// storage format to keep correct. A native login shows up in Settings ->
// Sessions like any other device, revoking it there logs the phone out, and it
// expires on the same schedule. Nothing here re-implements auth; it only moves
// the token from one place in the request to another before go-authkit's own
// middleware reads it.

const bearerPrefix = "Bearer "

// bearerAuthKey marks a request whose session came from an Authorization
// header rather than a cookie.
//
// An explicit mark rather than re-inspecting the request downstream: by the
// time CSRF runs, withBearerSession has already put the token in a cookie, so
// "does this have a session cookie" can no longer tell the two apart. Deciding
// once, where the fact is actually known, is what keeps the CSRF exemption from
// widening by accident later.
type bearerAuthKey struct{}

// authedByBearer reports whether this request was authenticated by a bearer
// token that withBearerSession promoted.
func authedByBearer(r *http.Request) bool {
	v, _ := r.Context().Value(bearerAuthKey{}).(bool)
	return v
}

// bearerToken returns the token from an Authorization header, or "".
func bearerToken(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) < len(bearerPrefix) || !strings.EqualFold(h[:len(bearerPrefix)], bearerPrefix) {
		return ""
	}
	return strings.TrimSpace(h[len(bearerPrefix):])
}

// withBearerSession promotes a bearer token into the session cookie the auth
// middleware expects, so one code path validates both kinds of client.
//
// Presented as a cookie rather than by looking the user up here because
// go-authkit stores the authenticated user under a context key it does not
// export: only its own RequireAuth can populate what httpmw.UserFrom reads.
// Rewriting the request is what lets every existing handler stay untouched, and
// means the token still goes through exactly the same validation, expiry and
// revocation checks a browser session does.
//
// A real session cookie wins when both are present, so a browser cannot be
// re-authenticated as someone else by an injected header.
func (s *Server) withBearerSession(next http.Handler) http.Handler {
	name := s.auth.CookieName()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r)
		if token == "" {
			next.ServeHTTP(w, r)
			return
		}
		if c, err := r.Cookie(name); err == nil && strings.TrimSpace(c.Value) != "" {
			next.ServeHTTP(w, r)
			return
		}
		// Clone so the rewrite cannot leak into anything holding the original.
		r2 := r.Clone(context.WithValue(r.Context(), bearerAuthKey{}, true))
		r2.AddCookie(&http.Cookie{Name: name, Value: token})
		next.ServeHTTP(w, r2)
	})
}

// csrfUnlessBearer applies CSRF protection to cookie requests only.
//
// CSRF exists because a browser attaches cookies to cross-site requests on its
// own, so possession of a cookie does not prove intent. An Authorization header
// is never attached ambiently — a hostile page can cause a request to be sent
// but cannot set that header, and cannot read the token to copy it. There is
// therefore nothing for a double-submit token to add, and requiring one would
// mean inventing a CSRF ceremony for a client that has no cookies at all.
//
// The exemption keys off the mark withBearerSession sets, which it only does
// when there was no session cookie to begin with. A browser request therefore
// always takes the CSRF path, even if something contrives to attach an
// Authorization header to it.
func (s *Server) csrfUnlessBearer(next http.Handler) http.Handler {
	protected := s.mw.RequireCSRF(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if authedByBearer(r) {
			next.ServeHTTP(w, r)
			return
		}
		protected.ServeHTTP(w, r)
	})
}
