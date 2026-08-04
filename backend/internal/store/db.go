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

// OpenSQLite opens (and pings) a pure-Go SQLite database at dbPath with
// foreign keys and WAL enabled for concurrency and integrity.
func OpenSQLite(dbPath string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=foreign_keys(ON)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)", filepath.ToSlash(dbPath))
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// SQLite handles one writer at a time; a single connection avoids
	// "database is locked" churn while WAL still allows concurrent readers.
	db.SetMaxOpenConns(1)
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
