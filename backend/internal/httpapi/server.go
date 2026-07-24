package httpapi

import (
	"net/http"
	"strings"

	"github.com/blurrycontour/activity-lens/backend/internal/config"
	"github.com/blurrycontour/activity-lens/backend/internal/web"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/auth"
	"github.com/blurrycontour/go-authkit/httpmw"
	"github.com/blurrycontour/go-authkit/oidc"
)

// Server bundles the dependencies needed to serve the API and SPA.
type Server struct {
	cfg     config.Config
	auth    *auth.Service
	mw      *httpmw.Middleware
	oidc    *oidc.Handler
	workout *workout.Service
}

// New constructs a Server and its auth middleware/OIDC handler.
func New(cfg config.Config, authSvc *auth.Service, workoutSvc *workout.Service) *Server {
	s := &Server{cfg: cfg, auth: authSvc, workout: workoutSvc}
	s.mw = &httpmw.Middleware{
		Auth:   authSvc,
		Secure: s.secure,
		Error: func(w http.ResponseWriter, _ *http.Request, status int, msg string) {
			writeError(w, status, msg)
		},
	}
	if cfg.OIDC.Enabled {
		s.oidc = &oidc.Handler{
			Auth:       authSvc,
			ConfigFunc: s.oidcConfig,
			Secure:     s.secure,
			ClientIP:   clientIP,
			OnSuccess:  s.oidcOnSuccess,
			OnError: func(w http.ResponseWriter, _ *http.Request, status int, msg string) {
				writeError(w, status, msg)
			},
		}
	}
	return s
}

// Handler builds the top-level http.Handler: API routes plus the SPA.
func (s *Server) Handler() (http.Handler, error) {
	api := s.apiRoutes()

	spa, err := web.Handler()
	if err != nil {
		return nil, err
	}

	root := http.NewServeMux()
	root.Handle("/api/", api)
	root.Handle("/", spa)
	return root, nil
}

// apiRoutes registers every /api endpoint.
func (s *Server) apiRoutes() http.Handler {
	mux := http.NewServeMux()

	// --- Auth (public) ---
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/auth/config", s.handleAuthConfig)
	if s.cfg.AllowRegistration {
		mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	}
	if s.oidc != nil {
		mux.HandleFunc("GET /api/auth/oidc/login", s.oidc.Login)
		mux.HandleFunc("GET /api/auth/oidc/callback", s.oidc.Callback)
	}

	// --- Auth (authenticated) ---
	mux.Handle("GET /api/auth/me", s.authed(s.handleMe))
	mux.Handle("POST /api/auth/logout", s.authedCSRF(s.handleLogout))
	mux.Handle("PATCH /api/auth/profile", s.authedCSRF(s.handleUpdateProfile))
	mux.Handle("POST /api/auth/password", s.authedCSRF(s.handleChangePassword))

	// --- Workouts (authenticated) ---
	mux.Handle("GET /api/workouts", s.authed(s.handleListWorkouts))
	mux.Handle("POST /api/workouts", s.authedCSRF(s.handleCreateWorkout))
	mux.Handle("GET /api/workouts/{id}", s.authed(s.handleGetWorkout))
	mux.Handle("PATCH /api/workouts/{id}", s.authedCSRF(s.handlePatchWorkout))
	mux.Handle("DELETE /api/workouts/{id}", s.authedCSRF(s.handleDeleteWorkout))
	mux.Handle("POST /api/workouts/import", s.authedCSRF(s.handleImportWorkout))
	mux.Handle("GET /api/stats", s.authed(s.handleStats))

	// Unknown API route -> JSON 404 (never fall through to the SPA).
	mux.HandleFunc("/api/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	return mux
}

// authed wraps a handler with RequireAuth.
func (s *Server) authed(h http.HandlerFunc) http.Handler {
	return s.mw.RequireAuth(h)
}

// authedCSRF wraps a handler with RequireAuth + RequireCSRF.
func (s *Server) authedCSRF(h http.HandlerFunc) http.Handler {
	return s.mw.RequireAuth(s.mw.RequireCSRF(h))
}

// secure reports whether cookies should carry the Secure flag for this request.
func (s *Server) secure(r *http.Request) bool {
	if s.cfg.SecureCookies {
		return true
	}
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https")
}

// clientIP extracts the client IP, honoring a single X-Forwarded-For hop.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	return r.RemoteAddr
}
