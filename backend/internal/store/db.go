// Package store owns the database connection and schema migrations. It keeps
// the concrete driver isolated so the rest of the app depends only on
// *sql.DB and repository interfaces, leaving the door open for Postgres (or an
// encrypted SQLite driver) without touching business logic.
package store

import (
	"context"
	"database/sql"
	_ "embed"
	"fmt"
	"path/filepath"
	"strings"

	_ "modernc.org/sqlite"
)

//go:embed migrations/0001_init.sql
var appSchema string

//go:embed migrations/0002_admin.sql
var adminSchema string

//go:embed migrations/0004_user_prefs.sql
var userPrefsSchema string

//go:embed migrations/0005_workout_steps.sql
var workoutStepsSchema string

//go:embed migrations/0006_user_prefs_hr.sql
var userPrefsHRSchema string

//go:embed migrations/0007_user_prefs_bio.sql
var userPrefsBioSchema string

//go:embed migrations/0008_workout_manual_flags.sql
var workoutManualFlagsSchema string

//go:embed migrations/0009_user_prefs_step_length.sql
var userPrefsStepLengthSchema string

//go:embed migrations/0010_equipment.sql
var equipmentSchema string

//go:embed migrations/0011_workout_cadence.sql
var workoutCadenceSchema string

//go:embed migrations/0012_goals_and_gear.sql
var goalsAndGearSchema string

//go:embed migrations/0013_multi_goals.sql
var multiGoalsSchema string

//go:embed migrations/0014_workout_dedupe.sql
var workoutDedupeSchema string

//go:embed migrations/0015_workout_sharing.sql
var workoutSharingSchema string

//go:embed migrations/0016_notifications.sql
var notificationsSchema string

//go:embed migrations/0017_notification_icon.sql
var notificationIconSchema string

//go:embed migrations/0018_raw_uploads_on_disk.sql
var rawUploadsOnDiskSchema string

//go:embed migrations/0019_push_kind.sql
var pushKindSchema string

//go:embed migrations/0020_feedback.sql
var feedbackSchema string

//go:embed migrations/0022_workout_weather.sql
var workoutWeatherSchema string

//go:embed migrations/0023_workout_tracks.sql
var workoutTracksSchema string

//go:embed migrations/0025_workout_media.sql
var workoutMediaSchema string

//go:embed migrations/0026_workout_social.sql
var workoutSocialSchema string

//go:embed migrations/0024_workout_pauses.sql
var workoutPausesSchema string

//go:embed migrations/0021_push_last_seen.sql
var pushLastSeenSchema string

//go:embed migrations/0027_session_clients.sql
var sessionClientsSchema string

//go:embed migrations/0028_user_tagline.sql
var userTaglineSchema string

//go:embed migrations/0029_cadence_points.sql
var cadencePointsSchema string

//go:embed migrations/0030_training_plans.sql
var trainingPlansSchema string

// maxOpenConns is how many connections the pool will open.
//
// It was 1, which made every request in the process queue behind every other
// one — including a request that only reads, behind one that is decompressing
// and encoding a megabyte of route. WAL allows any number of concurrent readers
// alongside a single writer, so serialising reads bought nothing but latency.
//
// Small on purpose: this is a handful of users, and each connection is a file
// handle and a page cache. Beyond a few, the writer is the limit anyway.
const maxOpenConns = 8

// OpenSQLite opens (and pings) a pure-Go SQLite database at dbPath with
// foreign keys and WAL enabled for concurrency and integrity.
func OpenSQLite(dbPath string) (*sql.DB, error) {
	// _txlock=immediate is what makes more than one connection safe, and it is
	// not optional.
	//
	// A transaction that reads before it writes — SELECT to check ownership,
	// then INSERT; go-authkit's OIDC user resolution and this app's equipment
	// linking both do it — starts under a shared lock and has to upgrade to
	// take the write lock. Two of those at once is a genuine deadlock: each
	// holds a read lock the other must wait out, and neither will yield.
	// busy_timeout does not help, because SQLite returns SQLITE_BUSY
	// immediately on an upgrade rather than waiting. It cannot happen today
	// only because the pool is one connection wide.
	//
	// BEGIN IMMEDIATE takes the write lock up front, so those transactions
	// queue for it cleanly instead of racing to upgrade. Every explicit
	// transaction in this codebase writes, so nothing pays for a lock it did
	// not need; a plain query outside a transaction is unaffected and still
	// runs concurrently with everything else.
	dsn := fmt.Sprintf("file:%s?_txlock=immediate&_pragma=foreign_keys(ON)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", filepath.ToSlash(dbPath))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(maxOpenConns)
	// Idle matches open so a burst of parallel requests reuses connections
	// rather than reopening the file and re-running the pragmas each time.
	db.SetMaxIdleConns(maxOpenConns)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	return db, nil
}

// MigrateApp applies the application schema. It is idempotent and safe to run
// on every startup.
func MigrateApp(ctx context.Context, db *sql.DB) error {
	if _, err := db.ExecContext(ctx, appSchema); err != nil {
		return fmt.Errorf("apply app schema: %w", err)
	}
	if _, err := db.ExecContext(ctx, adminSchema); err != nil {
		return fmt.Errorf("apply admin schema: %w", err)
	}
	if _, err := db.ExecContext(ctx, userPrefsSchema); err != nil {
		return fmt.Errorf("apply user prefs schema: %w", err)
	}
	// ALTER TABLE ADD COLUMN is not idempotent in SQLite; ignore the
	// duplicate-column error so this remains safe to run on every startup.
	if _, err := db.ExecContext(ctx, workoutStepsSchema); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
		return fmt.Errorf("apply workout steps schema: %w", err)
	}
	// Table creations run before the ALTER backfills below, which add columns
	// to them.
	if _, err := db.ExecContext(ctx, equipmentSchema); err != nil {
		return fmt.Errorf("apply equipment schema: %w", err)
	}
	// Training plans reference workouts(id), so this has to follow the app
	// schema that creates that table.
	if _, err := db.ExecContext(ctx, trainingPlansSchema); err != nil {
		return fmt.Errorf("apply training plans schema: %w", err)
	}
	// Backfill ALTER-based migrations on older databases. Each statement is
	// executed individually so a duplicate-column error on one does not abort
	// the rest, keeping startup idempotent.
	for _, m := range []struct {
		name   string
		schema string
	}{
		{"user prefs hr", userPrefsHRSchema},
		{"user prefs bio", userPrefsBioSchema},
		{"workout manual flags", workoutManualFlagsSchema},
		{"user prefs step length", userPrefsStepLengthSchema},
		{"workout cadence", workoutCadenceSchema},
		{"goals and gear", goalsAndGearSchema},
		{"multi goals", multiGoalsSchema},
		{"workout dedupe", workoutDedupeSchema},
		{"workout sharing", workoutSharingSchema},
		{"notifications", notificationsSchema},
		{"notification icon", notificationIconSchema},
		{"raw uploads on disk", rawUploadsOnDiskSchema},
		{"push kind", pushKindSchema},
		{"feedback", feedbackSchema},
		{"push last seen", pushLastSeenSchema},
		{"workout weather", workoutWeatherSchema},
		{"workout tracks", workoutTracksSchema},
		{"workout pauses", workoutPausesSchema},
		{"workout media", workoutMediaSchema},
		{"workout social", workoutSocialSchema},
		{"session clients", sessionClientsSchema},
		{"user tagline", userTaglineSchema},
		{"cadence points", cadencePointsSchema},
	} {
		if err := applyAlters(ctx, db, m.schema); err != nil {
			return fmt.Errorf("apply %s schema: %w", m.name, err)
		}
	}
	return nil
}

// applyAlters runs each semicolon-separated ALTER statement in schema
// individually, tolerating duplicate-column errors so re-running is safe.
func applyAlters(ctx context.Context, db *sql.DB, schema string) error {
	var sqlOnly strings.Builder
	for _, line := range strings.Split(schema, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		sqlOnly.WriteString(line)
		sqlOnly.WriteString("\n")
	}
	for _, stmt := range strings.Split(sqlOnly.String(), ";") {
		stmt = strings.TrimSpace(stmt)
		if stmt == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, stmt); err != nil && !strings.Contains(err.Error(), "duplicate column name") {
			return err
		}
	}
	return nil
}
