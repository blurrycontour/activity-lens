package notify

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrNotFound is returned when a notification does not exist, or belongs to
// somebody else — the two are deliberately indistinguishable to a caller.
var ErrNotFound = errors.New("notify: not found")

// Repository is the persistence seam, mirroring the pattern the workout and
// equipment packages use so a Postgres backend can be swapped in later.
type Repository interface {
	// Create stores a notification. When the event carries a DedupeKey and one
	// already exists for that user, it reports created=false and stores nothing.
	Create(ctx context.Context, n *Notification, dedupeKey string) (created bool, err error)
	List(ctx context.Context, userID int64, limit int) ([]Notification, error)
	UnreadCount(ctx context.Context, userID int64) (int, error)
	MarkRead(ctx context.Context, userID int64, id string) error
	MarkAllRead(ctx context.Context, userID int64) error
	Delete(ctx context.Context, userID int64, id string) error
	DeleteAll(ctx context.Context, userID int64) error
	// ClearDedupe drops the dedupe marker for a condition that has since been
	// resolved, so it can notify again if it recurs.
	ClearDedupe(ctx context.Context, userID int64, dedupeKey string) error

	SaveSubscription(ctx context.Context, s Subscription) error
	DeleteSubscription(ctx context.Context, endpoint string) error
	Subscriptions(ctx context.Context, userID int64) ([]Subscription, error)
	DeleteUserData(ctx context.Context, userID int64) error
}

// SQLiteRepository implements Repository on *sql.DB.
type SQLiteRepository struct{ db *sql.DB }

// NewSQLiteRepository builds a SQLite-backed notification repository.
func NewSQLiteRepository(db *sql.DB) *SQLiteRepository { return &SQLiteRepository{db: db} }

const notifCols = `id, user_id, kind, title, body, link, icon, read_at, created_at`

func (r *SQLiteRepository) Create(ctx context.Context, n *Notification, dedupeKey string) (bool, error) {
	if n.ID == "" {
		n.ID = newID()
	}
	if n.CreatedAt.IsZero() {
		n.CreatedAt = time.Now().UTC()
	}
	// The partial unique index on (user_id, dedupe_key) is what enforces
	// single-fire; ON CONFLICT turns the collision into a no-op rather than an
	// error the caller would have to interpret.
	//
	// The index's WHERE clause has to be repeated in the conflict target: both
	// SQLite and Postgres match a partial index by its predicate as well as its
	// columns, and omitting it fails with "does not match any PRIMARY KEY or
	// UNIQUE constraint". Rows with a NULL dedupe_key fall outside the index and
	// so are always inserted, which is what makes distinct events distinct.
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO notifications (`+notifCols+`, dedupe_key)
		 VALUES (?,?,?,?,?,?,?,NULL,?,?)
		 ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING`,
		n.ID, n.UserID, string(n.Kind), n.Title, n.Body, n.Link, n.Icon,
		n.CreatedAt.Format(time.RFC3339), nullIfEmpty(dedupeKey))
	if err != nil {
		return false, fmt.Errorf("insert notification: %w", err)
	}
	affected, _ := res.RowsAffected()
	return affected > 0, nil
}

func (r *SQLiteRepository) List(ctx context.Context, userID int64, limit int) ([]Notification, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+notifCols+` FROM notifications WHERE user_id = ?
		 ORDER BY created_at DESC LIMIT ?`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("query notifications: %w", err)
	}
	defer rows.Close()
	out := make([]Notification, 0)
	for rows.Next() {
		var (
			n         Notification
			kind      string
			readAt    sql.NullString
			createdAt string
		)
		if err := rows.Scan(&n.ID, &n.UserID, &kind, &n.Title, &n.Body, &n.Link, &n.Icon, &readAt, &createdAt); err != nil {
			return nil, err
		}
		n.Kind = Kind(kind)
		if t, err := time.Parse(time.RFC3339, createdAt); err == nil {
			n.CreatedAt = t
		}
		if readAt.Valid {
			if t, err := time.Parse(time.RFC3339, readAt.String); err == nil {
				n.ReadAt = &t
			}
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) UnreadCount(ctx context.Context, userID int64) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL`, userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count unread: %w", err)
	}
	return n, nil
}

func (r *SQLiteRepository) MarkRead(ctx context.Context, userID int64, id string) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`,
		time.Now().UTC().Format(time.RFC3339), id, userID)
	if err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	// Already-read is success: the caller's intent holds either way.
	if n, _ := res.RowsAffected(); n == 0 {
		return r.assertExists(ctx, userID, id)
	}
	return nil
}

func (r *SQLiteRepository) MarkAllRead(ctx context.Context, userID int64) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
		time.Now().UTC().Format(time.RFC3339), userID)
	if err != nil {
		return fmt.Errorf("mark all read: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) Delete(ctx context.Context, userID int64, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM notifications WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("delete notification: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SQLiteRepository) DeleteAll(ctx context.Context, userID int64) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM notifications WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("clear notifications: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) ClearDedupe(ctx context.Context, userID int64, dedupeKey string) error {
	if dedupeKey == "" {
		return nil
	}
	_, err := r.db.ExecContext(ctx,
		`UPDATE notifications SET dedupe_key = NULL WHERE user_id = ? AND dedupe_key = ?`, userID, dedupeKey)
	if err != nil {
		return fmt.Errorf("clear dedupe: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) assertExists(ctx context.Context, userID int64, id string) error {
	var one int
	err := r.db.QueryRowContext(ctx, `SELECT 1 FROM notifications WHERE id = ? AND user_id = ?`, id, userID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func (r *SQLiteRepository) SaveSubscription(ctx context.Context, s Subscription) error {
	// The endpoint is the device's identity, so re-subscribing updates the keys
	// (which rotate) rather than accumulating dead rows.
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, created_at)
		 VALUES (?,?,?,?,?,?)
		 ON CONFLICT (endpoint) DO UPDATE SET
		   user_id = excluded.user_id, p256dh = excluded.p256dh,
		   auth = excluded.auth, user_agent = excluded.user_agent`,
		s.Endpoint, s.UserID, s.P256dh, s.Auth, s.UserAgent,
		time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("save push subscription: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) DeleteSubscription(ctx context.Context, endpoint string) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint); err != nil {
		return fmt.Errorf("delete push subscription: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) Subscriptions(ctx context.Context, userID int64) ([]Subscription, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT endpoint, user_id, p256dh, auth, user_agent FROM push_subscriptions WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("query push subscriptions: %w", err)
	}
	defer rows.Close()
	out := make([]Subscription, 0)
	for rows.Next() {
		var s Subscription
		if err := rows.Scan(&s.Endpoint, &s.UserID, &s.P256dh, &s.Auth, &s.UserAgent); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) DeleteUserData(ctx context.Context, userID int64) error {
	for _, q := range []string{
		`DELETE FROM notifications WHERE user_id = ?`,
		`DELETE FROM push_subscriptions WHERE user_id = ?`,
	} {
		if _, err := r.db.ExecContext(ctx, q, userID); err != nil {
			return fmt.Errorf("delete notification data: %w", err)
		}
	}
	return nil
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func newID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
