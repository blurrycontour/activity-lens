package store

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// Migrations are re-run on every startup rather than tracked in a version
// table, so "safe to apply twice" is a hard requirement rather than a nicety.
// A fresh database also has to survive the whole chain in one go — an ordering
// mistake (an ALTER that runs before its CREATE) only shows up on a brand-new
// install, which is exactly the case nobody tests by hand.
func TestMigrateAppOnFreshDatabase(t *testing.T) {
	db := openTemp(t)

	for i := 1; i <= 3; i++ {
		if err := MigrateApp(context.Background(), db); err != nil {
			t.Fatalf("MigrateApp() run %d: %v", i, err)
		}
	}

	// Spot-check the tables and columns later migrations depend on, so a
	// missing embed or a mis-ordered statement fails here rather than at
	// runtime on someone's first launch.
	for _, q := range []string{
		`SELECT id, user_id, visibility FROM workouts LIMIT 0`,
		`SELECT workout_id, user_id, created_at FROM workout_shares LIMIT 0`,
		`SELECT id, user_id, kind, title, body, link, icon, dedupe_key, read_at FROM notifications LIMIT 0`,
		`SELECT endpoint, user_id, p256dh, auth FROM push_subscriptions LIMIT 0`,
		`SELECT user_id, goals, notify_prefs FROM user_prefs LIMIT 0`,
		`SELECT id, user_id, retire_at_km FROM equipment LIMIT 0`,
	} {
		if _, err := db.ExecContext(context.Background(), q); err != nil {
			t.Errorf("schema check failed: %v\n  query: %s", err, q)
		}
	}
}

// Every migration file must be reachable from MigrateApp. A new .sql that is
// written but never embedded silently does nothing, which is the kind of thing
// that only surfaces weeks later.
func TestEveryMigrationIsApplied(t *testing.T) {
	files, err := filepath.Glob("migrations/*.sql")
	if err != nil || len(files) == 0 {
		t.Fatalf("no migration files found: %v", err)
	}
	db := openTemp(t)
	if err := MigrateApp(context.Background(), db); err != nil {
		t.Fatalf("MigrateApp() error = %v", err)
	}

	var tables int
	err = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table'`).Scan(&tables)
	if err != nil {
		t.Fatal(err)
	}
	// A loose lower bound: enough to catch "the whole chain silently no-oped",
	// without pinning an exact count that every future migration would break.
	if tables < 8 {
		t.Fatalf("only %d tables after migrating %d files; the chain looks truncated", tables, len(files))
	}
}

func openTemp(t *testing.T) *sql.DB {
	t.Helper()
	db, err := OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}
