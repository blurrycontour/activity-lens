package httpapi

import (
	"net/http"
	"slices"
)

// Cross-origin access for the native app.
//
// The Android app is a WebView served from its own origin (https://localhost)
// talking to whatever server the user configured, so every API call is
// cross-origin and the browser enforces CORS on it. The web app is same-origin
// and is unaffected by any of this.
//
// Two properties keep this safe, and both matter:
//
//   - The origin is an allowlist, never a reflection of whatever asked. A
//     reflecting server is a same-origin bypass for any site that tries.
//   - Access-Control-Allow-Credentials is never sent. Cookies therefore stay
//     out of cross-origin requests entirely, so the only way to authenticate
//     from another origin is a bearer token — a value a hostile page cannot
//     read and cannot cause the browser to attach on its own.
//
// Together those mean opening CORS grants a hostile page nothing it could not
// already do by calling the server directly from its own backend.

// nativeOrigins are the origins an installed Capacitor build can present.
// Fixed by the platform rather than by configuration: Android WebViews serve
// from https://localhost under the recommended scheme, and older or
// differently-configured builds use the capacitor:// scheme. Listing both means
// the app works without the user having to configure anything on the server.
var nativeOrigins = []string{
	"https://localhost",
	"capacitor://localhost",
	"http://localhost",
}

// allowedOrigin reports whether this origin may read cross-origin responses.
func (s *Server) allowedOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	if slices.Contains(nativeOrigins, origin) {
		return true
	}
	return slices.Contains(s.cfg.CORSOrigins, origin)
}

// withCORS answers preflights and tags allowed cross-origin responses.
//
// Requests from origins that are not allowed are passed through untouched
// rather than rejected: without the response header the browser withholds the
// result anyway, and a server-side client has no origin to speak of and is not
// the thing CORS defends against.
func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if !s.allowedOrigin(origin) {
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				// A preflight that will not be allowed: answer it rather than
				// letting it fall through to a handler that would 404 or 405,
				// which is a confusing way to report a CORS problem.
				w.WriteHeader(http.StatusForbidden)
				return
			}
			next.ServeHTTP(w, r)
			return
		}

		h := w.Header()
		h.Set("Access-Control-Allow-Origin", origin)
		// The allowed origin varies by request, so any cache in front of this
		// must key on it. Without this a shared cache can hand one origin's
		// response, and its Allow-Origin header, to another.
		h.Add("Vary", "Origin")
		// Deliberately no Access-Control-Allow-Credentials: see above.

		if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			// Echoing the requested headers keeps this from breaking the first
			// time a client sends a header nobody listed here; the allowlist
			// that matters is the origin, not the header names.
			if req := r.Header.Get("Access-Control-Request-Headers"); req != "" {
				h.Set("Access-Control-Allow-Headers", req)
			} else {
				h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			}
			h.Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		// Content-Disposition carries the filename for a downloaded original,
		// which a cross-origin caller cannot read unless it is exposed.
		h.Set("Access-Control-Expose-Headers", "Content-Disposition")
		next.ServeHTTP(w, r)
	})
}
