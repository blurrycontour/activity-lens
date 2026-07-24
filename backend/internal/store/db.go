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

	_ "modernc.org/sqlite"
)

//go:embed migrations/0001_init.sql
var appSchema string

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
	return nil
}
