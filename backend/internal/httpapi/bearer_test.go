package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/config"
)

func TestBearerToken(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"typical", "Bearer abc123", "abc123"},
		// RFC 7235 makes the scheme case-insensitive, and HTTP clients differ.
		{"lowercase scheme", "bearer abc123", "abc123"},
		{"mixed case scheme", "BeArEr abc123", "abc123"},
		{"surrounding space is trimmed", "Bearer   abc123  ", "abc123"},
		{"absent", "", ""},
		{"a different scheme is not ours", "Basic dXNlcjpwYXNz", ""},
		{"scheme with no token", "Bearer ", ""},
		{"the word alone", "Bearer", ""},
		{"not a scheme at all", "abc123", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/api/workouts", nil)
			if tt.header != "" {
				r.Header.Set("Authorization", tt.header)
			}
			if got := bearerToken(r); got != tt.want {
				t.Errorf("bearerToken(%q) = %q, want %q", tt.header, got, tt.want)
			}
		})
	}
}

// newTestServer builds a Server with just enough wired for the middleware.
// The auth service is nil-free only where these tests reach; anything that
// would touch it fails loudly rather than silently passing.
func newCORSServer(origins ...string) *Server {
	return &Server{cfg: config.Config{CORSOrigins: origins}}
}

// Reflecting whatever Origin arrives would make every site same-origin with
// this API. The allowlist is the entire defence, so it gets a table.
func TestAllowedOrigin(t *testing.T) {
	s := newCORSServer("https://app.example.com")

	allowed := []string{
		// What the shipped app presents; see mobile/capacitor.config.ts.
		"https://activity-lens.localhost",
		// What a local build presents, so it saves passwords separately.
		"https://activity-lens-dev.localhost",
		"https://localhost",       // Capacitor default
		"capacitor://localhost",   // Capacitor, legacy scheme
		"http://localhost",        // local development
		"https://app.example.com", // configured
	}
	for _, o := range allowed {
		if !s.allowedOrigin(o) {
			t.Errorf("origin %q should be allowed", o)
		}
	}

	denied := []string{
		"",
		"https://evil.example.com",
		"https://app.example.com.evil.com", // suffix trick
		"https://evilapp.example.com",      // prefix trick
		"https://activity-lens.localhost.evil.com", // suffix trick on the app origin
		"http://activity-lens.localhost",           // scheme must match here too
		"http://app.example.com",                   // scheme must match
		"https://localhost:8443",                   // port is part of an origin
		"null",                                     // sandboxed iframes send this
	}
	for _, o := range denied {
		if s.allowedOrigin(o) {
			t.Errorf("origin %q must not be allowed", o)
		}
	}
}

// Credentialed CORS is the dangerous kind: it makes the browser attach cookies
// cross-origin, which would hand any allowed origin a working session. Bearer
// tokens exist precisely so this header is never needed.
func TestCORSNeverAllowsCredentials(t *testing.T) {
	s := newCORSServer()
	rec := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/workouts", nil)
	r.Header.Set("Origin", "https://localhost")

	s.withCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, r)

	if got := rec.Header().Get("Access-Control-Allow-Credentials"); got != "" {
		t.Fatalf("Access-Control-Allow-Credentials = %q; cookies must never cross origins here", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "https://localhost" {
		t.Errorf("Access-Control-Allow-Origin = %q, want the exact origin", got)
	}
	// A shared cache keyed without Origin could serve one origin's headers to
	// another, which would undo the allowlist.
	if got := rec.Header().Get("Vary"); got != "Origin" {
		t.Errorf("Vary = %q, want Origin", got)
	}
}

func TestCORSPreflight(t *testing.T) {
	s := newCORSServer()
	handlerRan := false
	h := s.withCORS(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { handlerRan = true }))

	rec := httptest.NewRecorder()
	r := httptest.NewRequest("OPTIONS", "/api/workouts/import", nil)
	r.Header.Set("Origin", "https://localhost")
	r.Header.Set("Access-Control-Request-Method", "POST")
	r.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	h.ServeHTTP(rec, r)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", rec.Code)
	}
	if handlerRan {
		t.Error("a preflight reached the real handler")
	}
	// Every import is multipart with an Authorization header, so a preflight
	// that does not allow both is an import that cannot run.
	if got := rec.Header().Get("Access-Control-Allow-Headers"); got != "authorization,content-type" {
		t.Errorf("Allow-Headers = %q, want the requested headers echoed", got)
	}
	if got := rec.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Error("preflight did not state the allowed methods")
	}
}

// A disallowed origin must not be told it is allowed. Answering the preflight
// with 403 rather than falling through keeps the failure legible.
func TestCORSRejectsUnknownOriginPreflight(t *testing.T) {
	s := newCORSServer()
	handlerRan := false
	h := s.withCORS(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { handlerRan = true }))

	rec := httptest.NewRecorder()
	r := httptest.NewRequest("OPTIONS", "/api/workouts", nil)
	r.Header.Set("Origin", "https://evil.example.com")
	r.Header.Set("Access-Control-Request-Method", "POST")
	h.ServeHTTP(rec, r)

	if rec.Code != http.StatusForbidden {
		t.Errorf("status = %d, want 403", rec.Code)
	}
	if handlerRan {
		t.Error("a rejected preflight reached the real handler")
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("a disallowed origin was given an Allow-Origin header")
	}
}

// A same-origin request has no Origin header and must be completely unaffected
// — this middleware sits in front of the whole API, including the web app's.
func TestCORSLeavesSameOriginRequestsAlone(t *testing.T) {
	s := newCORSServer()
	rec := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/workouts", nil)

	served := false
	s.withCORS(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		served = true
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, r)

	if !served {
		t.Fatal("a same-origin request was blocked")
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Error("a same-origin response carried CORS headers")
	}
}
