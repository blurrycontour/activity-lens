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

	// RecordCondition stores whether a standing condition holds, and reports
	// whether this call is the one that saw it become true. See Service.Crossed
	// for what the two answers mean.
	RecordCondition(ctx context.Context, userID int64, key string, active bool) (crossed bool, err error)

	SaveSubscription(ctx context.Context, s Subscription) error
	DeleteSubscription(ctx context.Context, endpoint string) error
	// PruneSubscriptions removes subscriptions no device has confirmed since
	// `before`, and reports how many went.
	PruneSubscriptions(ctx context.Context, before time.Time) (int64, error)
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

/*
RecordCondition writes the condition's current state and answers whether it
just became true.

Three steps rather than a read and a write, because two of them have to be
atomic and the third tells them apart:

  - The insert is the baseline. It succeeds only the first time this key is
    ever seen, and a first sighting is never news whatever it says -- that is
    what stops a goal completed before anyone was watching from being
    announced by the next unrelated workout.
  - Becoming true is a conditional update, and the row count is the answer.
    Two checks running at once (a bulk import and a plan session finishing)
    both see the same false and both try; exactly one changes a row, so
    exactly one notifies. A read followed by a write would let both through.
  - Becoming false just records it, so the next rise is a rise again.
*/
func (r *SQLiteRepository) RecordCondition(ctx context.Context, userID int64, key string, active bool) (bool, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.ExecContext(ctx,
		`INSERT INTO condition_state (user_id, key, active, updated_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (user_id, key) DO NOTHING`,
		userID, key, boolInt(active), now)
	if err != nil {
		return false, fmt.Errorf("record condition: %w", err)
	}
	if n, _ := res.RowsAffected(); n > 0 {
		return false, nil
	}

	if !active {
		if _, err := r.db.ExecContext(ctx,
			`UPDATE condition_state SET active = 0, updated_at = ? WHERE user_id = ? AND key = ? AND active = 1`,
			now, userID, key); err != nil {
			return false, fmt.Errorf("record condition: %w", err)
		}
		return false, nil
	}

	res, err = r.db.ExecContext(ctx,
		`UPDATE condition_state SET active = 1, updated_at = ? WHERE user_id = ? AND key = ? AND active = 0`,
		now, userID, key)
	if err != nil {
		return false, fmt.Errorf("record condition: %w", err)
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
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
	kind := s.Kind
	if kind == "" {
		kind = KindWebPush
	}
	// Every re-subscribe is also a heartbeat: clients send theirs on each
	// launch, and this column is how a subscription nobody is behind any more
	// is eventually told apart from one that simply has nothing to deliver.
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO push_subscriptions (endpoint, user_id, kind, p256dh, auth, user_agent, created_at, last_seen_at)
		 VALUES (?,?,?,?,?,?,?,?)
		 ON CONFLICT (endpoint) DO UPDATE SET
		   user_id = excluded.user_id, kind = excluded.kind, p256dh = excluded.p256dh,
		   auth = excluded.auth, user_agent = excluded.user_agent,
		   last_seen_at = excluded.last_seen_at`,
		s.Endpoint, s.UserID, kind, s.P256dh, s.Auth, s.UserAgent, now, now)
	if err != nil {
		return fmt.Errorf("save push subscription: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) PruneSubscriptions(ctx context.Context, before time.Time) (int64, error) {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM push_subscriptions WHERE last_seen_at < ?`,
		before.UTC().Format(time.RFC3339))
	if err != nil {
		return 0, fmt.Errorf("prune push subscriptions: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("prune push subscriptions: %w", err)
	}
	return n, nil
}

func (r *SQLiteRepository) DeleteSubscription(ctx context.Context, endpoint string) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM push_subscriptions WHERE endpoint = ?`, endpoint); err != nil {
		return fmt.Errorf("delete push subscription: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) Subscriptions(ctx context.Context, userID int64) ([]Subscription, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT endpoint, user_id, kind, p256dh, auth, user_agent FROM push_subscriptions WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("query push subscriptions: %w", err)
	}
	defer rows.Close()
	out := make([]Subscription, 0)
	for rows.Next() {
		var s Subscription
		if err := rows.Scan(&s.Endpoint, &s.UserID, &s.Kind, &s.P256dh, &s.Auth, &s.UserAgent); err != nil {
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
		`DELETE FROM condition_state WHERE user_id = ?`,
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
