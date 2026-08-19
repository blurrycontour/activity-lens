package workout

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// Comments and reactions on a workout.
//
// Every statement here is scoped by workout id and carries no permission logic
// of its own, exactly as the gallery's do. Two checks have to have happened
// before any of them run — the caller may see the workout, and the workout is
// shared — and both live in one place, in social.go's handlers. Splitting the
// second of them across these statements would mean the same three-table
// predicate written eight times, which is eight places for it to drift.

// SubjectKind is what a conversation is attached to.
type SubjectKind string

const (
	SubjectWorkout SubjectKind = "workout"
	SubjectPlan    SubjectKind = "plan"
	SubjectSession SubjectKind = "session"
)

// Subject names one thing a conversation hangs off.
//
// The social tables hold all three kinds in one pair of tables, with the
// subject in three nullable foreign keys of which exactly one is set — see
// migration 0038 for why. This is the value that picks which.
type Subject struct {
	Kind SubjectKind
	ID   string
}

func WorkoutSubject(id string) Subject { return Subject{SubjectWorkout, id} }
func PlanSubject(id string) Subject    { return Subject{SubjectPlan, id} }
func SessionSubject(id string) Subject { return Subject{SubjectSession, id} }

// column is the foreign key this subject lives in.
//
// Interpolated into SQL below, which is safe and stays safe because it is
// chosen from this closed set rather than derived from anything a caller
// sends: an unknown kind falls through to workout_id rather than to the
// caller's string. Nothing here is ever built from request data.
func (s Subject) column() string {
	switch s.Kind {
	case SubjectPlan:
		return "plan_id"
	case SubjectSession:
		return "session_id"
	default:
		return "workout_id"
	}
}

// Valid reports whether a kind is one this package stores.
func (s Subject) Valid() bool {
	return s.ID != "" && (s.Kind == SubjectWorkout || s.Kind == SubjectPlan || s.Kind == SubjectSession)
}

// Comment is one message on a workout, plan or session, by anyone who can see it.
type Comment struct {
	ID        string    `json:"id"`
	UserID    int64     `json:"-"`
	Body      string    `json:"body"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	// Author is filled in by the API layer from the user directory; the
	// workout tables have no join to the auth schema.
	Author *OwnerRef `json:"author,omitempty"`
}

// Reaction is one person's single emoji on a workout.
type Reaction struct {
	UserID    int64     `json:"-"`
	Emoji     string    `json:"emoji"`
	CreatedAt time.Time `json:"createdAt"`
	Author    *OwnerRef `json:"author,omitempty"`
}

// ErrCommentNotFound is returned when a comment id names nothing the caller may
// act on — either it does not exist, or it belongs to somebody else. One error
// for both, so a probe cannot tell them apart.
var ErrCommentNotFound = errors.New("comment not found")

// MaxCommentLength bounds one comment.
//
// Long enough for a paragraph about a race and short enough that no single row
// can be used to fill a self-hosted disk. Measured in runes, not bytes, so the
// limit is the same sentence in every language.
const MaxCommentLength = 2000

// ReactionEmojis is the set a reaction may be.
//
// A fixed list rather than any emoji the client sends: it keeps the row width
// predictable, makes the picker and the stored value the same vocabulary, and
// means the reaction bar can never carry text somebody typed.
//
// Order is the order they appear in the picker, six to a row: the first row is
// the ones that mean "well done", the second the ones that are a joke. Both are
// worth having — a training log among friends is not only for congratulating —
// and keeping them in one list rather than two means nothing downstream has to
// know which is which.
//
// Appending is safe; removing one is not. A stored reaction naming an emoji no
// longer here would stop being returned by the picker's own vocabulary and
// quietly vanish from the tally, so anything dropped needs a migration.
var ReactionEmojis = []string{
	"👏", "🔥", "💪", "🎉", "❤️", "😮",
	"💯", "🐐", "🚀", "🥵", "🌲", "💩",
}

// ValidReaction reports whether emoji is one this app stores.
func ValidReaction(emoji string) bool {
	for _, e := range ReactionEmojis {
		if e == emoji {
			return true
		}
	}
	return false
}

// newCommentID returns a random, unguessable comment id, for the same reason
// media ids are random: it appears in a URL on a workout other people can see.
func newCommentID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate comment id: %w", err)
	}
	return "c_" + hex.EncodeToString(b[:]), nil
}

// ── Comments ──────────────────────────────────────────────────────────────

const commentCols = `id, user_id, body, created_at, updated_at`

// ListComments returns a subject's comments, oldest first.
func (r *SQLiteRepository) ListComments(ctx context.Context, subj Subject) ([]Comment, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+commentCols+` FROM comments WHERE `+subj.column()+` = ? ORDER BY created_at, id`,
		subj.ID)
	if err != nil {
		return nil, fmt.Errorf("list comments: %w", err)
	}
	defer rows.Close()

	var out []Comment
	for rows.Next() {
		c, err := scanComment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// AddComment stores one message.
func (r *SQLiteRepository) AddComment(ctx context.Context, subj Subject, c Comment) error {
	stamp := c.CreatedAt.UTC().Format(time.RFC3339Nano)
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO comments (id, `+subj.column()+`, user_id, body, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		c.ID, subj.ID, c.UserID, c.Body, stamp, stamp)
	if err != nil {
		return fmt.Errorf("add comment: %w", err)
	}
	return nil
}

// UpdateComment edits a comment the caller wrote.
//
// The author check is in the WHERE clause rather than in a read-then-write:
// that makes "is this yours" and "change it" one statement, so there is no
// window between them and no second query to forget. Someone else's comment
// matches nothing and comes back as ErrCommentNotFound.
func (r *SQLiteRepository) UpdateComment(ctx context.Context, subj Subject, commentID string, authorID int64, body string) (Comment, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE comments SET body = ?, updated_at = ?
		 WHERE id = ? AND `+subj.column()+` = ? AND user_id = ?`,
		body, time.Now().UTC().Format(time.RFC3339Nano), commentID, subj.ID, authorID)
	if err != nil {
		return Comment{}, fmt.Errorf("update comment: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Comment{}, ErrCommentNotFound
	}
	return r.GetComment(ctx, subj, commentID)
}

// GetComment reads one comment, scoped to its subject so an id valid on one
// workout cannot be read through another's URL.
func (r *SQLiteRepository) GetComment(ctx context.Context, subj Subject, commentID string) (Comment, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+commentCols+` FROM comments WHERE `+subj.column()+` = ? AND id = ?`,
		subj.ID, commentID)
	c, err := scanComment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Comment{}, ErrCommentNotFound
	}
	return c, err
}

// DeleteComment removes a comment. requesterID must be its author, unless
// allowAny is set — which is how the workout's owner moderates their own page.
func (r *SQLiteRepository) DeleteComment(ctx context.Context, subj Subject, commentID string, requesterID int64, allowAny bool) error {
	query := `DELETE FROM comments WHERE id = ? AND ` + subj.column() + ` = ? AND user_id = ?`
	args := []any{commentID, subj.ID, requesterID}
	if allowAny {
		query = `DELETE FROM comments WHERE id = ? AND ` + subj.column() + ` = ?`
		args = []any{commentID, subj.ID}
	}
	res, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("delete comment: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrCommentNotFound
	}
	return nil
}

// DeleteCommentsForUser removes every comment a user wrote, wherever it lives.
//
// workout_comments is the table migration 0038 copied out of and no longer
// writes to. It is kept rather than dropped, as a readable backup of the
// threads that existed before the move — but a table still holding a deleted
// account's words is a leak whatever else it is, so the purge clears both. A
// later migration can drop it once the copy has proved itself.
func (r *SQLiteRepository) DeleteCommentsForUser(ctx context.Context, userID int64) error {
	for _, table := range []string{"comments", "workout_comments"} {
		if _, err := r.db.ExecContext(ctx, `DELETE FROM `+table+` WHERE user_id = ?`, userID); err != nil {
			return fmt.Errorf("delete comments for user: %w", err)
		}
	}
	return nil
}

func scanComment(s scanner) (Comment, error) {
	var (
		c                Comment
		created, updated string
	)
	if err := s.Scan(&c.ID, &c.UserID, &c.Body, &created, &updated); err != nil {
		return Comment{}, err
	}
	c.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	c.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return c, nil
}

// ── Reactions ─────────────────────────────────────────────────────────────

// ListReactions returns a subject's reactions, oldest first.
func (r *SQLiteRepository) ListReactions(ctx context.Context, subj Subject) ([]Reaction, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT user_id, emoji, created_at FROM reactions
		 WHERE `+subj.column()+` = ? ORDER BY created_at, user_id`, subj.ID)
	if err != nil {
		return nil, fmt.Errorf("list reactions: %w", err)
	}
	defer rows.Close()

	var out []Reaction
	for rows.Next() {
		var (
			re      Reaction
			created string
		)
		if err := rows.Scan(&re.UserID, &re.Emoji, &created); err != nil {
			return nil, err
		}
		re.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		out = append(out, re)
	}
	return out, rows.Err()
}

// SetReaction records one person's reaction, replacing whatever they had.
//
// A delete and an insert inside one transaction rather than an upsert. The
// upsert it replaces named a primary key that no longer exists: the reaction
// table now holds three kinds, so uniqueness is three *partial* indexes, and a
// conflict target naming one of them would have to be written out per kind and
// spelled differently in Postgres. Two plain statements under a transaction
// say the same thing in one form — and "one reaction each" is still the
// schema's guarantee, enforced by those indexes, not by this code.
func (r *SQLiteRepository) SetReaction(ctx context.Context, subj Subject, userID int64, emoji string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("set reaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM reactions WHERE `+subj.column()+` = ? AND user_id = ?`, subj.ID, userID); err != nil {
		return fmt.Errorf("set reaction: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO reactions (`+subj.column()+`, user_id, emoji, created_at) VALUES (?, ?, ?, ?)`,
		subj.ID, userID, emoji, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		return fmt.Errorf("set reaction: %w", err)
	}
	return tx.Commit()
}

// ClearReaction removes one person's reaction. Removing one that is not there
// is not an error: the wanted state is "no reaction from this user", and it
// already holds.
func (r *SQLiteRepository) ClearReaction(ctx context.Context, subj Subject, userID int64) error {
	if _, err := r.db.ExecContext(ctx,
		`DELETE FROM reactions WHERE `+subj.column()+` = ? AND user_id = ?`, subj.ID, userID); err != nil {
		return fmt.Errorf("clear reaction: %w", err)
	}
	return nil
}

// DeleteReactionsForUser removes every reaction a user left, wherever it
// lives. See DeleteCommentsForUser for why the superseded table is cleared too.
func (r *SQLiteRepository) DeleteReactionsForUser(ctx context.Context, userID int64) error {
	for _, table := range []string{"reactions", "workout_reactions"} {
		if _, err := r.db.ExecContext(ctx, `DELETE FROM `+table+` WHERE user_id = ?`, userID); err != nil {
			return fmt.Errorf("delete reactions for user: %w", err)
		}
	}
	return nil
}

// ── Shared-ness ───────────────────────────────────────────────────────────

// IsShared reports whether a workout is visible to anyone but its owner —
// public, or shared directly with at least one person.
//
// This is the gate the whole Social tab hangs on, so it is one named statement
// rather than a predicate spelled out at each call site. Owner-scoped: only the
// owner asks, because anyone else is already looking at the workout, which is
// itself proof that it is shared.
func (r *SQLiteRepository) IsShared(ctx context.Context, ownerID int64, workoutID string) (bool, error) {
	var shared bool
	err := r.db.QueryRowContext(ctx,
		`SELECT EXISTS (
		   SELECT 1 FROM workouts
		    WHERE id = ? AND user_id = ?
		      AND ( visibility = ?
		         OR EXISTS (SELECT 1 FROM workout_shares WHERE workout_id = workouts.id) ) )`,
		workoutID, ownerID, string(VisibilityPublic)).Scan(&shared)
	if err != nil {
		return false, fmt.Errorf("check shared: %w", err)
	}
	return shared, nil
}
