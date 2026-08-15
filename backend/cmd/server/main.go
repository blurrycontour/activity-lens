// Command server is the Activity Lens backend: it serves the JSON API and the
// embedded single-page frontend from one static binary.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/config"
	"github.com/blurrycontour/activity-lens/backend/internal/equipment"
	"github.com/blurrycontour/activity-lens/backend/internal/feedback"
	"github.com/blurrycontour/activity-lens/backend/internal/httpapi"
	"github.com/blurrycontour/activity-lens/backend/internal/notify"
	"github.com/blurrycontour/activity-lens/backend/internal/sessions"
	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/store"
	"github.com/blurrycontour/activity-lens/backend/internal/weather"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/auth"
	sqlitestore "github.com/blurrycontour/go-authkit/store/sqlite"
)

// Build provenance, set at build time via -ldflags "-X main.<name>=...".
// Everything but version is empty outside a Docker build; see the Dockerfile.
var (
	version  = "dev"
	revision string
	created  string
	licenses string
	source   string
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	if err := run(); err != nil {
		slog.Error("server exited with error", "error", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	ctx := context.Background()

	if err := os.MkdirAll(cfg.DataDir, 0o750); err != nil {
		return err
	}

	dbPath := filepath.Join(cfg.DataDir, "activity-lens.db")
	db, err := store.OpenSQLite(dbPath)
	if err != nil {
		return err
	}
	defer db.Close()

	// Auth persistence (go-authkit) + application schema share one database.
	authStore := sqlitestore.New(db)
	if err := authStore.Migrate(ctx); err != nil {
		return err
	}
	if err := store.MigrateApp(ctx, db); err != nil {
		return err
	}
	slog.Info("database ready", "path", dbPath, "data_dir", cfg.DataDir)

	authSvc := auth.NewService(authStore, auth.Config{
		SessionCookieName: cfg.CookieName,
		SessionTTL:        cfg.SessionTTL,
	})
	if err := authSvc.EnsureBootstrapAdmin(ctx, auth.BootstrapAdmin{
		Username: cfg.AdminUser,
		Email:    cfg.AdminEmail,
		Password: cfg.AdminPass,
	}); err != nil {
		return err
	}
	if users, err := authSvc.ListUsers(ctx); err == nil {
		slog.Info("accounts", "count", len(users))
	}

	workoutSvc := workout.NewService(workout.NewSQLiteRepository(db))
	equipmentSvc := equipment.NewService(equipment.NewSQLiteRepository(db))
	settingsStore := settings.New(db)
	rawUploads := workout.NewRawUploadStore(cfg.DataDir)

	// Web Push keys are generated on first run and kept in the database, so a
	// fresh self-hosted install has working push with nothing to configure.
	vapid, err := settingsStore.VAPIDKeys(ctx, notify.GenerateVAPIDKeys)
	if err != nil {
		slog.Warn("push notifications unavailable", "error", err)
	}
	notifySvc := notify.NewService(
		notify.NewSQLiteRepository(db),
		notify.VAPIDKeys{Public: vapid.Public, Private: vapid.Private, Subject: cfg.PushSubject},
		func(ctx context.Context, userID int64) (notify.Prefs, error) {
			prefs, err := settingsStore.UserPreferences(ctx, userID)
			if err != nil {
				return notify.DefaultPrefs(), err
			}
			return notify.DecodePrefs(prefs.Notify), nil
		},
	)
	slog.Info("notifications ready", "push", vapid.Public != "")

	feedbackSvc := feedback.NewService(feedback.NewSQLiteRepository(db))

	apiServer := httpapi.New(cfg, authSvc, workoutSvc, equipmentSvc, settingsStore, rawUploads, notifySvc, feedbackSvc, httpapi.BuildInfo{
		Version:  version,
		Revision: revision,
		Created:  created,
		Licenses: licenses,
		Source:   source,
	})
	// Historical weather for imported workouts. Nothing leaves the server for a
	// user who has switched it off, and nothing already in the library is looked
	// up unless they ask for a backfill.
	apiServer.UseWeather(weather.New().At)
	// Which client each session is, and what each account has accumulated —
	// both only ever read by Settings -> Security and the admin screens.
	apiServer.UseSessionClients(sessions.NewStore(db))
	apiServer.UseAdminStats(httpapi.NewAdminStatsStore(db, cfg.DataDir))

	handler, err := apiServer.Handler()
	if err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	// Time-driven notification checks (goal periods running out).
	go apiServer.StartScheduler(ctx)

	go func() {
		// revision/built only exist in a Docker build; omit them otherwise
		// rather than logging empty strings on every local run.
		ready := []any{"version", version, "addr", cfg.Addr, "oidc", cfg.OIDC.Enabled,
			"registration", cfg.AllowRegistration, "secure_cookies", cfg.SecureCookies}
		if revision != "" {
			ready = append(ready, "revision", revision, "built", created)
		}
		slog.Info("activity-lens ready", ready...)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("listen and serve", "error", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	slog.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}
