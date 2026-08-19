package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/config"
	"github.com/blurrycontour/activity-lens/backend/internal/equipment"
	"github.com/blurrycontour/activity-lens/backend/internal/feedback"
	"github.com/blurrycontour/activity-lens/backend/internal/notify"
	"github.com/blurrycontour/activity-lens/backend/internal/plans"
	"github.com/blurrycontour/activity-lens/backend/internal/sessions"
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
	cfg       config.Config
	auth      *auth.Service
	mw        *httpmw.Middleware
	oidc      *oidc.Handler
	workout   *workout.Service
	equipment *equipment.Service
	// plans is training plans, or nil when this server was built without
	// them — see UsePlans.
	plans      *plans.Service
	settings   *settings.Store
	rawUploads *workout.RawUploadStore
	// Gallery photos on disk. Always present; unlike raw uploads there is no
	// setting for it, because a photo exists only because someone added it.
	media    *workout.MediaStore
	notify   *notify.Service
	feedback *feedback.Service
	build    BuildInfo
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
	// sessionClients records what kind of client each session is. Nil disables
	// the whole feature, which keeps every existing Server construction in the
	// tests valid.
	sessionClients *sessions.Store
	// sessionSeen throttles the "last active" writes; see sessiontrack.go.
	sessionSeen *sessionTracker
	// pings holds the cooldown between one member nudging another. In memory
	// and per process; see ping.go for why that is the right store for it.
	pings *pingLimiter
	// adminStats computes per-user totals for the admin screens. Nil leaves
	// those numbers at zero rather than failing the page.
	adminStats *AdminStatsStore
}

// New constructs a Server and its auth middleware/OIDC handler.
func New(cfg config.Config, authSvc *auth.Service, workoutSvc *workout.Service, equipmentSvc *equipment.Service, settingsStore *settings.Store, rawUploads *workout.RawUploadStore, notifySvc *notify.Service, feedbackSvc *feedback.Service, build BuildInfo) *Server {
	s := &Server{cfg: cfg, auth: authSvc, workout: workoutSvc, equipment: equipmentSvc, settings: settingsStore, rawUploads: rawUploads, media: workout.NewMediaStore(cfg.DataDir), notify: notifySvc, feedback: feedbackSvc, build: build}
	s.apk = loadBundledAPK(cfg.AndroidAPKDir)
	s.nativeCodes = newNativeAuthCodes()
	s.weatherWake = make(chan struct{}, 1)
	s.sessionSeen = newSessionTracker()
	s.pings = newPingLimiter()
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

// UseSessionClients wires per-session client tracking. Optional for the same
// reason UseWeather is: without it the device lists fall back to the user agent
// go-authkit already stores, and every existing test's Server stays valid.
func (s *Server) UseSessionClients(store *sessions.Store) { s.sessionClients = store }

// UseAdminStats wires the per-user totals shown in Admin -> Users.
func (s *Server) UseAdminStats(store *AdminStatsStore) { s.adminStats = store }

// UsePlans wires training plans. Optional for the same reason UseWeather is:
// New already takes nine dependencies, and leaving this unset keeps every
// existing test's Server valid — the routes then answer 404, which is what a
// client that asks for a feature this server does not have should hear.
func (s *Server) UsePlans(svc *plans.Service) { s.plans = svc }

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
	// withJSONTransfer sits inside the access log so the log records the status
	// actually sent — a 304 should read as a 304 — and inside CORS so the
	// preflight response, which has no body, never reaches it. See transfer.go.
	root.Handle("/api/", s.withCORS(withAccessLog(withJSONTransfer(api))))
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
	// The gallery. Reading follows the workout's visibility, writing needs
	// ownership — see media.go, where both checks live.
	mux.Handle("GET /api/workouts/{id}/media", s.authed(s.handleListMedia))
	mux.Handle("POST /api/workouts/{id}/media", s.authedCSRF(s.handleUploadMedia))
	mux.Handle("GET /api/workouts/{id}/media/{mediaID}", s.authed(s.handleServeMedia))
	mux.Handle("DELETE /api/workouts/{id}/media/{mediaID}", s.authedCSRF(s.handleDeleteMedia))
	// Comments and reactions, readable by anyone who can see the workout and
	// writable only while it is shared — see social.go, where both gates live.
	mux.Handle("GET /api/workouts/{id}/social", s.authed(s.handleGetSocial(s.resolveSocial)))
	mux.Handle("POST /api/workouts/{id}/comments", s.authedCSRF(s.handleAddComment(s.resolveSocial)))
	mux.Handle("PATCH /api/workouts/{id}/comments/{commentID}", s.authedCSRF(s.handleEditComment(s.resolveSocial)))
	mux.Handle("DELETE /api/workouts/{id}/comments/{commentID}", s.authedCSRF(s.handleDeleteComment(s.resolveSocial)))
	mux.Handle("PUT /api/workouts/{id}/reaction", s.authedCSRF(s.handleSetReaction(s.resolveSocial)))
	mux.Handle("POST /api/workouts/{id}/recalculate", s.authedCSRF(s.handleRecalculateWorkout))
	mux.Handle("POST /api/workouts/{id}/reshape", s.authedCSRF(s.handleReshapeWorkout))
	mux.Handle("POST /api/workouts/{id}/restore", s.authedCSRF(s.handleRestoreWorkout))
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
	// Another member, and the workouts of theirs you can already see.
	mux.Handle("GET /api/users/{id}", s.authed(s.handleUserProfile))
	// A nudge from one member to another. The message is chosen from a fixed
	// list the server owns, never typed — see ping.go.
	mux.Handle("POST /api/users/{id}/ping", s.authedCSRF(s.handlePingUser))

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
	// --- Training plans (authenticated) ---
	mux.Handle("GET /api/plans", s.authed(s.withPlans(s.handleListPlans)))
	mux.Handle("POST /api/plans", s.authedCSRF(s.withPlans(s.handleCreatePlan)))
	mux.Handle("GET /api/plans/{id}", s.authed(s.withPlans(s.handleGetPlan)))
	mux.Handle("PATCH /api/plans/{id}", s.authedCSRF(s.withPlans(s.handlePatchPlan)))
	mux.Handle("DELETE /api/plans/{id}", s.authedCSRF(s.withPlans(s.handleDeletePlan)))
	mux.Handle("PUT /api/plans/{id}/days", s.authedCSRF(s.withPlans(s.handlePutPlanDays)))
	// Before /api/plans/{id}, or "exercise-names" is read as a plan id.
	mux.Handle("GET /api/plan-exercise-names", s.authed(s.withPlans(s.handleExerciseNames)))
	// Sessions sit beside plans rather than under one, because a session
	// outlives the plan it came from.
	mux.Handle("GET /api/plan-sessions", s.authed(s.withPlans(s.handleListPlanSessions)))
	mux.Handle("POST /api/plan-sessions", s.authedCSRF(s.withPlans(s.handleStartPlanSession)))
	mux.Handle("GET /api/plan-sessions/active", s.authed(s.withPlans(s.handleActivePlanSession)))
	mux.Handle("GET /api/plan-sessions/{id}", s.authed(s.withPlans(s.handleGetPlanSession)))
	mux.Handle("PATCH /api/plan-sessions/{id}", s.authedCSRF(s.withPlans(s.handlePatchPlanSession)))
	mux.Handle("PUT /api/plan-sessions/{id}/progress", s.authedCSRF(s.withPlans(s.handleSavePlanProgress)))
	mux.Handle("POST /api/plan-sessions/{id}/finish", s.authedCSRF(s.withPlans(s.handleFinishPlanSession)))
	mux.Handle("DELETE /api/plan-sessions/{id}", s.authedCSRF(s.withPlans(s.handleDeletePlanSession)))
	mux.Handle("POST /api/plan-sessions/delete", s.authedCSRF(s.withPlans(s.handleDeletePlanSessions)))

	// --- Plan & session sharing (authenticated) --- see plan_sharing.go.
	mux.Handle("GET /api/plans/{id}/shares", s.authed(s.withPlans(s.handleListPlanShares)))
	mux.Handle("POST /api/plans/{id}/shares", s.authedCSRF(s.withPlans(s.handleAddPlanShare)))
	mux.Handle("DELETE /api/plans/{id}/shares/{userId}", s.authedCSRF(s.withPlans(s.handleRemovePlanShare)))
	mux.Handle("PUT /api/plans/{id}/visibility", s.authedCSRF(s.withPlans(s.handleSetPlanVisibility)))
	mux.Handle("POST /api/plans/{id}/clone", s.authedCSRF(s.withPlans(s.handleClonePlan)))
	mux.Handle("GET /api/plan-sessions/{id}/shares", s.authed(s.withPlans(s.handleListSessionShares)))
	mux.Handle("POST /api/plan-sessions/{id}/shares", s.authedCSRF(s.withPlans(s.handleAddSessionShare)))
	mux.Handle("DELETE /api/plan-sessions/{id}/shares/{userId}", s.authedCSRF(s.withPlans(s.handleRemoveSessionShare)))
	mux.Handle("PUT /api/plan-sessions/{id}/visibility", s.authedCSRF(s.withPlans(s.handleSetSessionVisibility)))
	// The same conversation, on a plan and on a session. One set of handlers
	// for all three kinds; only "may they see it, and is it shared" differs,
	// which is what the resolver answers — see social.go.
	mux.Handle("GET /api/plans/{id}/social", s.authed(s.withPlans(s.handleGetSocial(s.resolvePlanSocial))))
	mux.Handle("POST /api/plans/{id}/comments", s.authedCSRF(s.withPlans(s.handleAddComment(s.resolvePlanSocial))))
	mux.Handle("PATCH /api/plans/{id}/comments/{commentID}", s.authedCSRF(s.withPlans(s.handleEditComment(s.resolvePlanSocial))))
	mux.Handle("DELETE /api/plans/{id}/comments/{commentID}", s.authedCSRF(s.withPlans(s.handleDeleteComment(s.resolvePlanSocial))))
	mux.Handle("PUT /api/plans/{id}/reaction", s.authedCSRF(s.withPlans(s.handleSetReaction(s.resolvePlanSocial))))
	mux.Handle("GET /api/plan-sessions/{id}/social", s.authed(s.withPlans(s.handleGetSocial(s.resolveSessionSocial))))
	mux.Handle("POST /api/plan-sessions/{id}/comments", s.authedCSRF(s.withPlans(s.handleAddComment(s.resolveSessionSocial))))
	mux.Handle("PATCH /api/plan-sessions/{id}/comments/{commentID}", s.authedCSRF(s.withPlans(s.handleEditComment(s.resolveSessionSocial))))
	mux.Handle("DELETE /api/plan-sessions/{id}/comments/{commentID}", s.authedCSRF(s.withPlans(s.handleDeleteComment(s.resolveSessionSocial))))
	mux.Handle("PUT /api/plan-sessions/{id}/reaction", s.authedCSRF(s.withPlans(s.handleSetReaction(s.resolveSessionSocial))))

	mux.Handle("GET /api/feed/plans/public", s.authed(s.withPlans(s.handleFeedPlansPublic)))
	mux.Handle("GET /api/feed/plans/shared", s.authed(s.withPlans(s.handleFeedPlansShared)))
	mux.Handle("GET /api/feed/sessions/public", s.authed(s.withPlans(s.handleFeedSessionsPublic)))
	mux.Handle("GET /api/feed/sessions/shared", s.authed(s.withPlans(s.handleFeedSessionsShared)))

	mux.Handle("POST /api/equipment/{id}/workouts", s.authedCSRF(s.handleLinkWorkouts))
	mux.Handle("DELETE /api/equipment/{id}/workouts/{workoutId}", s.authedCSRF(s.handleUnlinkWorkout))

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
	mux.Handle("PUT /api/admin/settings/social", s.authedAdminCSRF(s.handleSaveSocial))
	mux.Handle("POST /api/admin/settings/smtp/test", s.authedAdminCSRF(s.handleTestEmail))
	mux.Handle("GET /api/admin/users", s.authedAdmin(s.handleListUsers))
	mux.Handle("POST /api/admin/users", s.authedAdminCSRF(s.handleCreateUser))
	mux.Handle("PATCH /api/admin/users/{id}", s.authedAdminCSRF(s.handleUpdateUser))
	mux.Handle("DELETE /api/admin/users/{id}", s.authedAdminCSRF(s.handleDeleteUser))
	// Everything one admin screen shows about one account, in one response.
	mux.Handle("GET /api/admin/users/{id}", s.authedAdmin(s.handleGetAdminUser))
	mux.Handle("DELETE /api/admin/users/{id}/sessions/{sessionId}", s.authedAdminCSRF(s.handleRevokeUserSession))
	mux.Handle("DELETE /api/admin/users/{id}/sessions", s.authedAdminCSRF(s.handleRevokeUserSessions))
	mux.Handle("POST /api/admin/broadcast", s.authedAdminCSRF(s.handleBroadcast))

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
//
// withSessionTracking sits inside RequireAuth in all four of these, so it runs
// with a resolved user and session id, and only for requests that got that far.
// See sessiontrack.go.
func (s *Server) authed(h http.HandlerFunc) http.Handler {
	return s.withBearerSession(s.mw.RequireAuth(s.withSessionTracking(h)))
}

// authedCSRF wraps a handler with RequireAuth + CSRF (cookie clients only).
func (s *Server) authedCSRF(h http.HandlerFunc) http.Handler {
	return s.withBearerSession(s.mw.RequireAuth(s.withSessionTracking(s.csrfUnlessBearer(h))))
}

// authedAdmin wraps a handler with RequireAuth + RequireAdmin.
func (s *Server) authedAdmin(h http.HandlerFunc) http.Handler {
	return s.withBearerSession(s.mw.RequireAuth(s.withSessionTracking(s.mw.RequireAdmin(h))))
}

// authedAdminCSRF wraps a handler with RequireAuth + RequireAdmin + CSRF.
func (s *Server) authedAdminCSRF(h http.HandlerFunc) http.Handler {
	return s.withBearerSession(s.mw.RequireAuth(s.withSessionTracking(s.mw.RequireAdmin(s.csrfUnlessBearer(h)))))
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
