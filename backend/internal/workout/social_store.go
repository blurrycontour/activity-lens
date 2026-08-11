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

// Comment is one message on a workout, by anyone who can see it.
type Comment struct {
	ID        string    `json:"id"`
	WorkoutID string    `json:"-"`
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
	WorkoutID string    `json:"-"`
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
// means the reaction bar can never carry text somebody typed. Order is the
// order they appear in the picker.
var ReactionEmojis = []string{"👏", "🔥", "💪", "🎉", "❤️", "😮"}

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

const commentCols = `id, workout_id, user_id, body, created_at, updated_at`

// ListComments returns a workout's comments, oldest first.
func (r *SQLiteRepository) ListComments(ctx context.Context, workoutID string) ([]Comment, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+commentCols+` FROM workout_comments WHERE workout_id = ? ORDER BY created_at, id`,
		workoutID)
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
func (r *SQLiteRepository) AddComment(ctx context.Context, c Comment) error {
	stamp := c.CreatedAt.UTC().Format(time.RFC3339Nano)
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO workout_comments (`+commentCols+`) VALUES (?, ?, ?, ?, ?, ?)`,
		c.ID, c.WorkoutID, c.UserID, c.Body, stamp, stamp)
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
func (r *SQLiteRepository) UpdateComment(ctx context.Context, workoutID, commentID string, authorID int64, body string) (Comment, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE workout_comments SET body = ?, updated_at = ?
		 WHERE id = ? AND workout_id = ? AND user_id = ?`,
		body, time.Now().UTC().Format(time.RFC3339Nano), commentID, workoutID, authorID)
	if err != nil {
		return Comment{}, fmt.Errorf("update comment: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return Comment{}, ErrCommentNotFound
	}
	return r.GetComment(ctx, workoutID, commentID)
}

// GetComment reads one comment, scoped to its workout so an id valid on one
// workout cannot be read through another's URL.
func (r *SQLiteRepository) GetComment(ctx context.Context, workoutID, commentID string) (Comment, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+commentCols+` FROM workout_comments WHERE workout_id = ? AND id = ?`,
		workoutID, commentID)
	c, err := scanComment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Comment{}, ErrCommentNotFound
	}
	return c, err
}

// DeleteComment removes a comment. requesterID must be its author, unless
// allowAny is set — which is how the workout's owner moderates their own page.
func (r *SQLiteRepository) DeleteComment(ctx context.Context, workoutID, commentID string, requesterID int64, allowAny bool) error {
	query := `DELETE FROM workout_comments WHERE id = ? AND workout_id = ? AND user_id = ?`
	args := []any{commentID, workoutID, requesterID}
	if allowAny {
		query = `DELETE FROM workout_comments WHERE id = ? AND workout_id = ?`
		args = []any{commentID, workoutID}
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
func (r *SQLiteRepository) DeleteCommentsForUser(ctx context.Context, userID int64) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM workout_comments WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("delete comments for user: %w", err)
	}
	return nil
}

func scanComment(s scanner) (Comment, error) {
	var (
		c                Comment
		created, updated string
	)
	if err := s.Scan(&c.ID, &c.WorkoutID, &c.UserID, &c.Body, &created, &updated); err != nil {
		return Comment{}, err
	}
	c.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	c.UpdatedAt, _ = time.Parse(time.RFC3339Nano, updated)
	return c, nil
}

// ── Reactions ─────────────────────────────────────────────────────────────

// ListReactions returns a workout's reactions, oldest first.
func (r *SQLiteRepository) ListReactions(ctx context.Context, workoutID string) ([]Reaction, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT workout_id, user_id, emoji, created_at FROM workout_reactions
		 WHERE workout_id = ? ORDER BY created_at, user_id`, workoutID)
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
		if err := rows.Scan(&re.WorkoutID, &re.UserID, &re.Emoji, &created); err != nil {
			return nil, err
		}
		re.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
		out = append(out, re)
	}
	return out, rows.Err()
}

// SetReaction records one person's reaction, replacing whatever they had.
//
// An upsert on the primary key, which is what makes "one reaction each" a
// property of the schema rather than of the handler: a double tap and two
// racing tabs both end with exactly one row.
func (r *SQLiteRepository) SetReaction(ctx context.Context, workoutID string, userID int64, emoji string) error {
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO workout_reactions (workout_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(workout_id, user_id) DO UPDATE SET emoji = excluded.emoji`,
		workoutID, userID, emoji, time.Now().UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("set reaction: %w", err)
	}
	return nil
}

// ClearReaction removes one person's reaction. Removing one that is not there
// is not an error: the wanted state is "no reaction from this user", and it
// already holds.
func (r *SQLiteRepository) ClearReaction(ctx context.Context, workoutID string, userID int64) error {
	if _, err := r.db.ExecContext(ctx,
		`DELETE FROM workout_reactions WHERE workout_id = ? AND user_id = ?`, workoutID, userID); err != nil {
		return fmt.Errorf("clear reaction: %w", err)
	}
	return nil
}

// DeleteReactionsForUser removes every reaction a user left, wherever it lives.
func (r *SQLiteRepository) DeleteReactionsForUser(ctx context.Context, userID int64) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM workout_reactions WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("delete reactions for user: %w", err)
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
