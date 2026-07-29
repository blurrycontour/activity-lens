package httpapi

import (
	"net/http"
	"strings"

	"github.com/blurrycontour/activity-lens/backend/internal/config"
	"github.com/blurrycontour/activity-lens/backend/internal/equipment"
	"github.com/blurrycontour/activity-lens/backend/internal/notify"
	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/web"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/auth"
	"github.com/blurrycontour/go-authkit/httpmw"
	"github.com/blurrycontour/go-authkit/oidc"
)

// Server bundles the dependencies needed to serve the API and SPA.
type Server struct {
	cfg        config.Config
	auth       *auth.Service
	mw         *httpmw.Middleware
	oidc       *oidc.Handler
	workout    *workout.Service
	equipment  *equipment.Service
	settings   *settings.Store
	rawUploads *workout.RawUploadStore
	notify     *notify.Service
	build      BuildInfo
}

// New constructs a Server and its auth middleware/OIDC handler.
func New(cfg config.Config, authSvc *auth.Service, workoutSvc *workout.Service, equipmentSvc *equipment.Service, settingsStore *settings.Store, rawUploads *workout.RawUploadStore, notifySvc *notify.Service, build BuildInfo) *Server {
	s := &Server{cfg: cfg, auth: authSvc, workout: workoutSvc, equipment: equipmentSvc, settings: settingsStore, rawUploads: rawUploads, notify: notifySvc, build: build}
	s.mw = &httpmw.Middleware{
		Auth:   authSvc,
		Secure: s.secure,
		Error: func(w http.ResponseWriter, _ *http.Request, status int, msg string) {
			writeError(w, status, msg)
		},
	}
	// The OIDC handler is always wired: its ConfigFunc resolves the effective
	// config per request (env + database), so SSO can be toggled from the admin
	// UI without a restart. When disabled, its endpoints return 404.
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
	root.Handle("/api/", withAccessLog(api))
	root.Handle("/", spa)
	return root, nil
}

// apiRoutes registers every /api endpoint.
func (s *Server) apiRoutes() http.Handler {
	mux := http.NewServeMux()

	// --- Auth (public) ---
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("GET /api/auth/config", s.handleAuthConfig)
	// Public: an OS-level push notification fetches the sender's avatar from
	// outside any session, so this cannot require a cookie. Filenames are
	// random, the handler reads no user state, and an avatar is low-sensitivity
	// — but it is readable by anyone holding the URL.
	mux.HandleFunc("GET /api/avatars/auto/{seed}", s.handleAutoAvatar)
	mux.HandleFunc("GET /api/avatars/{file}", s.handleServeAvatar)
	if s.cfg.AllowRegistration {
		mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	}
	if s.oidc != nil {
		mux.HandleFunc("GET /api/auth/oidc/login", s.oidc.Login)
		mux.HandleFunc("GET /api/auth/oidc/callback", s.oidc.Callback)
	}

	// --- Auth (authenticated) ---
	mux.Handle("GET /api/auth/me", s.authed(s.handleMe))
	mux.Handle("GET /api/build", s.authed(s.handleBuildInfo))
	mux.Handle("POST /api/auth/logout", s.authedCSRF(s.handleLogout))
	mux.Handle("PATCH /api/auth/profile", s.authedCSRF(s.handleUpdateProfile))
	mux.Handle("POST /api/auth/password", s.authedCSRF(s.handleChangePassword))
	mux.Handle("POST /api/auth/avatar", s.authedCSRF(s.handleUploadAvatar))
	mux.Handle("DELETE /api/auth/avatar", s.authedCSRF(s.handleDeleteAvatar))

	mux.Handle("GET /api/auth/sessions", s.authed(s.handleListSessions))
	mux.Handle("POST /api/auth/sessions/revoke-others", s.authedCSRF(s.handleRevokeOtherSessions))
	mux.Handle("DELETE /api/auth/sessions/{id}", s.authedCSRF(s.handleRevokeSession))
	mux.Handle("POST /api/auth/account/deletion/request", s.authedCSRF(s.handleRequestAccountDeletion))
	mux.Handle("POST /api/auth/account/deletion", s.authedCSRF(s.handleConfirmAccountDeletion))

	// --- Workouts (authenticated) ---
	mux.Handle("GET /api/workouts", s.authed(s.handleListWorkouts))
	mux.Handle("POST /api/workouts", s.authedCSRF(s.handleCreateWorkout))
	mux.Handle("GET /api/workouts/{id}", s.authed(s.handleGetWorkout))
	mux.Handle("PATCH /api/workouts/{id}", s.authedCSRF(s.handlePatchWorkout))
	mux.Handle("DELETE /api/workouts/{id}", s.authedCSRF(s.handleDeleteWorkout))
	mux.Handle("GET /api/workouts/{id}/original", s.authed(s.handleDownloadOriginal))
	mux.Handle("POST /api/workouts/{id}/recalculate", s.authedCSRF(s.handleRecalculateWorkout))
	mux.Handle("POST /api/workouts/import", s.authedCSRF(s.handleImportWorkout))
	mux.Handle("POST /api/workouts/preview", s.authedCSRF(s.handlePreviewWorkout))
	mux.Handle("GET /api/stats", s.authed(s.handleStats))
	mux.Handle("GET /api/preferences", s.authed(s.handleGetPreferences))
	mux.Handle("PUT /api/preferences", s.authedCSRF(s.handleSavePreferences))

	// --- Sharing (authenticated) ---
	// Owner-facing: every route is scoped to the caller's own workouts.
	mux.Handle("GET /api/workouts/{id}/shares", s.authed(s.handleListWorkoutShares))
	mux.Handle("POST /api/workouts/{id}/shares", s.authedCSRF(s.handleAddWorkoutShare))
	mux.Handle("DELETE /api/workouts/{id}/shares/{userId}", s.authedCSRF(s.handleRemoveWorkoutShare))
	mux.Handle("PUT /api/workouts/{id}/visibility", s.authedCSRF(s.handleSetWorkoutVisibility))
	// Viewer-facing: other people's workouts. Still behind auth — "public"
	// means every signed-in user of this instance, never the open internet.
	mux.Handle("GET /api/feed/public", s.authed(s.handleFeedPublic))
	mux.Handle("GET /api/feed/shared", s.authed(s.handleFeedShared))
	// Minimal user directory backing the share picker.
	mux.Handle("GET /api/users", s.authed(s.handleListUserDirectory))

	// --- Notifications (authenticated) ---
	mux.Handle("GET /api/notifications", s.authed(s.handleListNotifications))
	mux.Handle("POST /api/notifications/read-all", s.authedCSRF(s.handleMarkAllNotificationsRead))
	mux.Handle("POST /api/notifications/{id}/read", s.authedCSRF(s.handleMarkNotificationRead))
	mux.Handle("DELETE /api/notifications/{id}", s.authedCSRF(s.handleDeleteNotification))
	mux.Handle("DELETE /api/notifications", s.authedCSRF(s.handleClearNotifications))
	mux.Handle("POST /api/push/subscribe", s.authedCSRF(s.handlePushSubscribe))
	mux.Handle("POST /api/push/unsubscribe", s.authedCSRF(s.handlePushUnsubscribe))

	// --- Equipment (authenticated) ---
	mux.Handle("GET /api/equipment", s.authed(s.handleListEquipment))
	mux.Handle("POST /api/equipment", s.authedCSRF(s.handleCreateEquipment))
	mux.Handle("GET /api/equipment/{id}", s.authed(s.handleGetEquipment))
	mux.Handle("PATCH /api/equipment/{id}", s.authedCSRF(s.handlePatchEquipment))
	mux.Handle("DELETE /api/equipment/{id}", s.authedCSRF(s.handleDeleteEquipment))

	// --- Admin (administrators only) ---
	mux.Handle("GET /api/admin/settings", s.authedAdmin(s.handleGetSettings))
	mux.Handle("PUT /api/admin/settings/smtp", s.authedAdminCSRF(s.handleSaveSMTP))
	mux.Handle("PUT /api/admin/settings/oidc", s.authedAdminCSRF(s.handleSaveOIDC))
	mux.Handle("PUT /api/admin/settings/storage", s.authedAdminCSRF(s.handleSaveStorage))
	mux.Handle("POST /api/admin/settings/smtp/test", s.authedAdminCSRF(s.handleTestEmail))
	mux.Handle("GET /api/admin/users", s.authedAdmin(s.handleListUsers))
	mux.Handle("POST /api/admin/users", s.authedAdminCSRF(s.handleCreateUser))
	mux.Handle("PATCH /api/admin/users/{id}", s.authedAdminCSRF(s.handleUpdateUser))
	mux.Handle("DELETE /api/admin/users/{id}", s.authedAdminCSRF(s.handleDeleteUser))

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

// authedAdmin wraps a handler with RequireAuth + RequireAdmin.
func (s *Server) authedAdmin(h http.HandlerFunc) http.Handler {
	return s.mw.RequireAuth(s.mw.RequireAdmin(h))
}

// authedAdminCSRF wraps a handler with RequireAuth + RequireAdmin + RequireCSRF.
func (s *Server) authedAdminCSRF(h http.HandlerFunc) http.Handler {
	return s.mw.RequireAuth(s.mw.RequireAdmin(s.mw.RequireCSRF(h)))
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
