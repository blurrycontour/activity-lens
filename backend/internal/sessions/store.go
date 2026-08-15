package sessions

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// Kinds a client may declare. Anything else is stored as empty, so a made-up
// value cannot show up in an admin's device list as though it were a real
// platform — the header is caller-supplied and reaches here unauthenticated in
// the sense that any signed-in client can say anything.
const (
	KindWeb     = "web"
	KindAndroid = "android"
)

// maxVersionLen bounds what a client can write into the version column. The
// header is free text from the client; a device list is no place to discover
// that someone put a kilobyte in it.
const maxVersionLen = 32

// Client is what a session's own software told us about itself.
type Client struct {
	Kind       string
	AppVersion string
	LastSeen   string
}

// Store persists per-session client facts alongside go-authkit's sessions.
type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store { return &Store{db: db} }

// ParseClientHeader reads the X-Activity-Lens-Client header, whose form is
// "<kind>/<version>" — "web/1.11.1", "android/1.11.1".
//
// Unrecognised kinds and over-long versions are dropped rather than stored,
// because both ends of this are attacker-controlled: any signed-in client can
// send whatever it likes, and what it sends is rendered in an admin screen.
func ParseClientHeader(h string) Client {
	kind, version, _ := strings.Cut(strings.TrimSpace(h), "/")
	kind = strings.ToLower(strings.TrimSpace(kind))
	if kind != KindWeb && kind != KindAndroid {
		return Client{}
	}
	version = strings.TrimSpace(version)
	if len(version) > maxVersionLen {
		version = version[:maxVersionLen]
	}
	// Versions are printed verbatim, so keep them to the shape of a version.
	for _, r := range version {
		ok := r == '.' || r == '-' || r == '_' || r == '+' ||
			(r >= '0' && r <= '9') || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z')
		if !ok {
			return Client{Kind: kind}
		}
	}
	return Client{Kind: kind, AppVersion: version}
}

// Record writes what a client said about itself, and stamps it as seen now.
//
// Called at login and then periodically from the request path, so it has to be
// an upsert: a session is created once and seen thousands of times. A client
// that declares nothing still gets a row, because "last seen" is worth having
// on its own and an older app that sends no header is exactly the session an
// admin most wants to notice.
func (s *Store) Record(ctx context.Context, sessionID string, userID int64, c Client) error {
	if sessionID == "" {
		return nil
	}
	now := time.Now().UTC().Format(time.RFC3339)
	// The kind and version are only overwritten when the caller has something
	// to say. A background request from a stale tab must not blank out what the
	// app reported at login.
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO session_clients (session_id, user_id, kind, app_version, last_seen)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(session_id) DO UPDATE SET
		   last_seen   = excluded.last_seen,
		   kind        = CASE WHEN excluded.kind        != '' THEN excluded.kind        ELSE session_clients.kind        END,
		   app_version = CASE WHEN excluded.app_version != '' THEN excluded.app_version ELSE session_clients.app_version END`,
		sessionID, userID, c.Kind, c.AppVersion, now)
	if err != nil {
		return fmt.Errorf("record session client: %w", err)
	}
	return nil
}

// ForSessions returns what is known about a set of sessions, keyed by session
// id. Absent ids simply have no entry: a session that predates this table is a
// normal thing to render, not an error.
func (s *Store) ForSessions(ctx context.Context, sessionIDs []string) (map[string]Client, error) {
	out := make(map[string]Client, len(sessionIDs))
	if len(sessionIDs) == 0 {
		return out, nil
	}
	// One statement with a placeholder per id, rather than a query per session.
	// The list is however many devices one person is signed in on.
	args := make([]any, len(sessionIDs))
	for i, id := range sessionIDs {
		args[i] = id
	}
	q := `SELECT session_id, kind, app_version, last_seen FROM session_clients WHERE session_id IN (?` +
		strings.Repeat(",?", len(sessionIDs)-1) + `)`
	rows, err := s.db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("query session clients: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		var c Client
		if err := rows.Scan(&id, &c.Kind, &c.AppVersion, &c.LastSeen); err != nil {
			return nil, err
		}
		out[id] = c
	}
	return out, rows.Err()
}

// PruneOrphans deletes rows whose session is gone — revoked, expired or logged
// out. go-authkit deletes those rows itself and knows nothing about this table,
// so nothing else would ever clear them.
//
// Not a foreign key on purpose: sessions belongs to another module, and a
// constraint against it would tie this migration to that module's schema and to
// the order the two run in.
func (s *Store) PruneOrphans(ctx context.Context) (int64, error) {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM session_clients
		 WHERE NOT EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_clients.session_id)`)
	if err != nil {
		return 0, fmt.Errorf("prune session clients: %w", err)
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// PurgeUser drops everything recorded for one user, for account deletion.
func (s *Store) PurgeUser(ctx context.Context, userID int64) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM session_clients WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("purge session clients: %w", err)
	}
	return nil
}
