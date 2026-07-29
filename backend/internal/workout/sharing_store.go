package workout

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// This file holds the SQL for sharing. The authorization predicate lives here,
// in GetViewable, rather than in the service or an API handler: it is the only
// query in the codebase that returns a workout the caller may not own, so
// keeping it inside one named statement is what makes "can this user read this"
// impossible to forget elsewhere.

func (r *SQLiteRepository) GetViewable(ctx context.Context, viewerID int64, id string) (*Workout, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+selectCols+` FROM workouts
		WHERE workouts.id = ?
		  AND ( workouts.user_id = ?
		     OR workouts.visibility = ?
		     OR EXISTS (SELECT 1 FROM workout_shares
		                 WHERE workout_shares.workout_id = workouts.id
		                   AND workout_shares.user_id = ?) )`,
		id, viewerID, string(VisibilityPublic), viewerID)
	w, err := scanWorkout(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return w, err
}

func (r *SQLiteRepository) ListPublicSummary(ctx context.Context, viewerID int64) ([]Workout, error) {
	return r.querySummaries(ctx, `SELECT `+selectSummaryCols+` FROM workouts
		WHERE workouts.visibility = ? AND workouts.user_id <> ?
		ORDER BY workouts.start_time DESC`, string(VisibilityPublic), viewerID)
}

func (r *SQLiteRepository) ListSharedWithMeSummary(ctx context.Context, viewerID int64) ([]Workout, error) {
	// A subquery rather than a join: the shared column list is unqualified, and
	// joining workout_shares would make user_id ambiguous. The user_id <> ?
	// guard means a stray self-share row could never make a workout appear in
	// your own "shared with me" list.
	return r.querySummaries(ctx, `SELECT `+selectSummaryCols+` FROM workouts
		WHERE workouts.id IN (SELECT workout_id FROM workout_shares WHERE user_id = ?)
		  AND workouts.user_id <> ?
		ORDER BY workouts.start_time DESC`, viewerID, viewerID)
}

func (r *SQLiteRepository) querySummaries(ctx context.Context, query string, args ...any) ([]Workout, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query workouts: %w", err)
	}
	defer rows.Close()
	out := make([]Workout, 0)
	for rows.Next() {
		w, err := scanWorkoutSummary(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) SetVisibility(ctx context.Context, ownerID int64, id string, v Visibility) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE workouts SET visibility = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		string(v), time.Now().UTC().Format(time.RFC3339), id, ownerID)
	if err != nil {
		return fmt.Errorf("set visibility: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SQLiteRepository) ShareRecipients(ctx context.Context, ownerID int64, workoutID string) ([]int64, error) {
	if err := r.assertOwned(ctx, ownerID, workoutID); err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx,
		`SELECT user_id FROM workout_shares WHERE workout_id = ? ORDER BY created_at`, workoutID)
	if err != nil {
		return nil, fmt.Errorf("query share recipients: %w", err)
	}
	defer rows.Close()
	out := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) ShareCounts(ctx context.Context, ownerID int64) (map[string]int, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT workout_shares.workout_id, COUNT(*)
		FROM workout_shares
		JOIN workouts ON workouts.id = workout_shares.workout_id
		WHERE workouts.user_id = ?
		GROUP BY workout_shares.workout_id`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("query share counts: %w", err)
	}
	defer rows.Close()
	out := make(map[string]int)
	for rows.Next() {
		var (
			id string
			n  int
		)
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) AddShare(ctx context.Context, ownerID int64, workoutID string, targetID int64) error {
	if err := r.assertOwned(ctx, ownerID, workoutID); err != nil {
		return err
	}
	// ON CONFLICT DO NOTHING makes a repeat share a no-op rather than an error.
	// The ownership check above and this insert are deliberately not wrapped in
	// a transaction: the only race is a concurrent delete of the workout, which
	// the foreign key turns into a harmless constraint failure.
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO workout_shares (workout_id, user_id, created_at) VALUES (?,?,?)
		 ON CONFLICT (workout_id, user_id) DO NOTHING`,
		workoutID, targetID, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("add share: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) RemoveShare(ctx context.Context, ownerID int64, workoutID string, targetID int64) error {
	if err := r.assertOwned(ctx, ownerID, workoutID); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx,
		`DELETE FROM workout_shares WHERE workout_id = ? AND user_id = ?`, workoutID, targetID)
	if err != nil {
		return fmt.Errorf("remove share: %w", err)
	}
	// Removing a share that was not there is treated as success — the caller's
	// intent ("this person should not have access") already holds.
	return nil
}

func (r *SQLiteRepository) DeleteSharesForUser(ctx context.Context, userID int64) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM workout_shares WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("delete shares for user: %w", err)
	}
	return nil
}

// assertOwned returns ErrNotFound unless ownerID owns workoutID, so a
// non-owner cannot tell an existing workout from a missing one.
func (r *SQLiteRepository) assertOwned(ctx context.Context, ownerID int64, workoutID string) error {
	var one int
	err := r.db.QueryRowContext(ctx,
		`SELECT 1 FROM workouts WHERE id = ? AND user_id = ?`, workoutID, ownerID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("check workout owner: %w", err)
	}
	return nil
}
