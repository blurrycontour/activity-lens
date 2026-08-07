package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/config"
	"github.com/blurrycontour/activity-lens/backend/internal/equipment"
	"github.com/blurrycontour/activity-lens/backend/internal/feedback"
	"github.com/blurrycontour/activity-lens/backend/internal/notify"
	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/weather"
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
	feedback   *feedback.Service
	build      BuildInfo
	// apk is the Android app bundled into this image, or nil when there is
	// none. Resolved once at startup; see androidapp.go.
	apk *bundledAPK
	// nativeCodes holds one-time SSO codes between the browser redirect and the
	// Android app collecting them; see oidc_native.go.
	nativeCodes *nativeAuthCodes
	// weather looks up the historical conditions a workout happened in. Nil
	// disables the whole feature, which is what keeps every existing test's
	// Server construction valid and gives a deployment a way to opt out.
	weather weather.Fetcher
	// weatherCooldownUntil pauses the weather pass after Open-Meteo tells us we
	// have asked for too much. Touched only by the scheduler goroutine.
	weatherCooldownUntil time.Time
	// lastWeatherPass paces nudged passes. Touched only by the scheduler.
	lastWeatherPass time.Time
	// weatherWake carries "something was just imported" from a request handler
	// to the scheduler. One slot: a nudge is a fact, not a count, and a bulk
	// import that sends five hundred of them should cost one wakeup. Nil when no
	// scheduler is running, which NudgeWeather treats as "nothing to tell".
	weatherWake chan struct{}
}

// New constructs a Server and its auth middleware/OIDC handler.
func New(cfg config.Config, authSvc *auth.Service, workoutSvc *workout.Service, equipmentSvc *equipment.Service, settingsStore *settings.Store, rawUploads *workout.RawUploadStore, notifySvc *notify.Service, feedbackSvc *feedback.Service, build BuildInfo) *Server {
	s := &Server{cfg: cfg, auth: authSvc, workout: workoutSvc, equipment: equipmentSvc, settings: settingsStore, rawUploads: rawUploads, notify: notifySvc, feedback: feedbackSvc, build: build}
	s.apk = loadBundledAPK(cfg.AndroidAPKDir)
	s.nativeCodes = newNativeAuthCodes()
	s.weatherWake = make(chan struct{}, 1)
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

// UseWeather wires the historical-weather lookup.
//
// Optional, and separate from New because New already takes nine dependencies
// and this one is genuinely optional: without it the background pass returns
// immediately and the feature is inert, which is what every existing test gets
// for free and what a deployment that would rather not call out gets by
// leaving it unset.
func (s *Server) UseWeather(f weather.Fetcher) { s.weather = f }

// Handler builds the top-level http.Handler: API routes plus the SPA.
func (s *Server) Handler() (http.Handler, error) {
	api := s.apiRoutes()

	spa, err := web.Handler()
	if err != nil {
		return nil, err
	}

	root := http.NewServeMux()
	// CORS wraps the API only. The SPA is same-origin by definition, and the
	// native app never loads it over the network — it ships its own copy.
	root.Handle("/api/", s.withCORS(withAccessLog(api)))
	root.Handle("/", spa)
	return root, nil
}

// apiRoutes registers every /api endpoint.
func (s *Server) apiRoutes() http.Handler {
	mux := http.NewServeMux()

	// --- Auth (public) ---
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	// Same sign-in, token in the body instead of a cookie, for the native app.
	mux.HandleFunc("POST /api/auth/token", s.handleIssueToken)
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
		// Wrapped rather than registered directly: the native app passes two
		// extra parameters that have to be carried through the flow. See
		// oidc_native.go.
		mux.HandleFunc("GET /api/auth/oidc/login", s.handleOIDCLogin)
		mux.HandleFunc("GET /api/auth/oidc/callback", s.oidc.Callback)
		// Where the app redeems the code the deep link brought it.
		mux.HandleFunc("POST /api/auth/oidc/exchange", s.handleOIDCExchange)
	}

	// --- Auth (authenticated) ---
	mux.Handle("GET /api/auth/me", s.authed(s.handleMe))
	mux.Handle("GET /api/build", s.authed(s.handleBuildInfo))
	// Public: the download button is on the login page, and the Android app
	// checks for updates before anyone signs in.
	mux.HandleFunc("GET /api/app/android", s.handleAndroidApp)
	mux.HandleFunc("GET /api/app/android/download", s.handleAndroidDownload)
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
	// Weather a person typed in, for when the grid average is not good enough.
	mux.Handle("PUT /api/workouts/{id}/weather", s.authedCSRF(s.handleSetWorkoutWeather))
	mux.Handle("DELETE /api/workouts/{id}/weather", s.authedCSRF(s.handleClearWorkoutWeather))
	// How many older workouts have never been checked, and the action that
	// queues them. Four segments, so neither collides with /api/workouts/{id}.
	mux.Handle("GET /api/workouts/tracks", s.authed(s.handleWorkoutTracks))
	mux.Handle("GET /api/workouts/weather/status", s.authed(s.handleWeatherStatus))
	mux.Handle("POST /api/workouts/weather/backfill", s.authedCSRF(s.handleRequestWeatherBackfill))
	mux.Handle("POST /api/workouts/weather/retry", s.authedCSRF(s.handleRetryFailedWeather))
	mux.Handle("POST /api/workouts/import", s.authedCSRF(s.handleImportWorkout))
	// Bulk import support: ask once which files are already held, and run the
	// deferred gear/goal checks once when the batch finishes.
	mux.Handle("POST /api/workouts/import/known", s.authedCSRF(s.handleKnownImports))
	mux.Handle("POST /api/workouts/import/finalize", s.authedCSRF(s.handleFinalizeImport))
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
	mux.Handle("POST /api/push/unifiedpush", s.authedCSRF(s.handleUnifiedPushSubscribe))
	mux.Handle("POST /api/push/unsubscribe", s.authedCSRF(s.handlePushUnsubscribe))

	// --- Equipment (authenticated) ---
	mux.Handle("GET /api/equipment", s.authed(s.handleListEquipment))
	mux.Handle("POST /api/equipment", s.authedCSRF(s.handleCreateEquipment))
	mux.Handle("GET /api/equipment/{id}", s.authed(s.handleGetEquipment))
	mux.Handle("PATCH /api/equipment/{id}", s.authedCSRF(s.handlePatchEquipment))
	mux.Handle("DELETE /api/equipment/{id}", s.authedCSRF(s.handleDeleteEquipment))

	// Feedback: anyone may file one, only admins may read them.
	mux.Handle("POST /api/feedback", s.authedCSRF(s.handleCreateFeedback))

	// --- Admin (administrators only) ---
	mux.Handle("GET /api/admin/feedback", s.authedAdmin(s.handleListFeedback))
	mux.Handle("GET /api/admin/feedback/{id}", s.authedAdmin(s.handleGetFeedback))
	mux.Handle("PATCH /api/admin/feedback/{id}", s.authedAdminCSRF(s.handleUpdateFeedback))
	mux.Handle("DELETE /api/admin/feedback/{id}", s.authedAdminCSRF(s.handleDeleteFeedback))
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

// Every authenticated route is wrapped in withBearerSession, so the native
// app's Authorization header is understood everywhere a cookie is, and CSRF is
// applied to cookie clients only. See bearer.go for why.

// authed wraps a handler with RequireAuth.
func (s *Server) authed(h http.HandlerFunc) http.Handler {
	return s.withBearerSession(s.mw.RequireAuth(h))
}

// authedCSRF wraps a handler with RequireAuth + CSRF (cookie clients only).
func (s *Server) authedCSRF(h http.HandlerFunc) http.Handler {
	return s.withBearerSession(s.mw.RequireAuth(s.csrfUnlessBearer(h)))
}

// authedAdmin wraps a handler with RequireAuth + RequireAdmin.
func (s *Server) authedAdmin(h http.HandlerFunc) http.Handler {
	return s.withBearerSession(s.mw.RequireAuth(s.mw.RequireAdmin(h)))
}

// authedAdminCSRF wraps a handler with RequireAuth + RequireAdmin + CSRF.
func (s *Server) authedAdminCSRF(h http.HandlerFunc) http.Handler {
	return s.withBearerSession(s.mw.RequireAuth(s.mw.RequireAdmin(s.csrfUnlessBearer(h))))
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
