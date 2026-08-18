package plans

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// Sharing for plans and sessions. Two near-identical method sets rather than
// one generic one over an item id — a plan and a session live in different
// tables with different summary columns, and the query that finds "can this
// viewer read this" is the one place that has to name the table explicitly,
// same reasoning as workout.SQLiteRepository.GetViewable.

// --- Plans -----------------------------------------------------------------

func (r *SQLiteRepository) GetViewablePlan(ctx context.Context, viewerID int64, id string) (*Plan, error) {
	p, err := scanPlan(r.db.QueryRowContext(ctx,
		`SELECT `+planCols+` FROM training_plans p
		  WHERE p.id = ?
		    AND ( p.user_id = ?
		       OR p.visibility = ?
		       OR EXISTS (SELECT 1 FROM plan_shares WHERE plan_shares.plan_id = p.id
		                   AND plan_shares.user_id = ?) )`,
		id, viewerID, string(workout.VisibilityPublic), viewerID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get viewable plan: %w", err)
	}
	days, err := r.loadDays(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.Days = days
	return p, nil
}

func (r *SQLiteRepository) ListPublicPlans(ctx context.Context, viewerID int64) ([]Plan, error) {
	return r.queryPlanSummaries(ctx, `SELECT `+planCols+` FROM training_plans p
		WHERE p.visibility = ? AND p.user_id <> ?
		ORDER BY p.updated_at DESC`, string(workout.VisibilityPublic), viewerID)
}

func (r *SQLiteRepository) ListSharedPlansWithMe(ctx context.Context, viewerID int64) ([]Plan, error) {
	return r.queryPlanSummaries(ctx, `SELECT `+planCols+` FROM training_plans p
		WHERE p.id IN (SELECT plan_id FROM plan_shares WHERE user_id = ?)
		  AND p.user_id <> ?
		ORDER BY p.updated_at DESC`, viewerID, viewerID)
}

// ListPlansSharedByMeWith is the outbound half of a profile: the caller's own
// plans that they have sent to one named person. Owner-scoped, so the
// recipient id narrows the query and grants nothing.
func (r *SQLiteRepository) ListPlansSharedByMeWith(ctx context.Context, ownerID, recipientID int64) ([]Plan, error) {
	return r.queryPlanSummaries(ctx, `SELECT `+planCols+` FROM training_plans p
		WHERE p.user_id = ?
		  AND p.id IN (SELECT plan_id FROM plan_shares WHERE user_id = ?)
		ORDER BY p.updated_at DESC`, ownerID, recipientID)
}

// PlanShareRecipientsByPlan maps each of the caller's shared plans to who it
// went to, in one query rather than one per row.
func (r *SQLiteRepository) PlanShareRecipientsByPlan(ctx context.Context, ownerID int64) (map[string][]int64, error) {
	return r.queryRecipientsByItem(ctx, `SELECT plan_shares.plan_id, plan_shares.user_id
		FROM plan_shares
		JOIN training_plans ON training_plans.id = plan_shares.plan_id
		WHERE training_plans.user_id = ?
		ORDER BY plan_shares.plan_id, plan_shares.created_at`, ownerID)
}

func (r *SQLiteRepository) queryPlanSummaries(ctx context.Context, query string, args ...any) ([]Plan, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query plans: %w", err)
	}
	defer rows.Close()
	out := make([]Plan, 0)
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) SetPlanVisibility(ctx context.Context, ownerID int64, id string, v workout.Visibility) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE training_plans SET visibility = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
		string(v), now(), id, ownerID)
	if err != nil {
		return fmt.Errorf("set plan visibility: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SQLiteRepository) PlanShareRecipients(ctx context.Context, ownerID int64, planID string) ([]int64, error) {
	if err := r.assertOwnsPlan(ctx, ownerID, planID); err != nil {
		return nil, err
	}
	return r.queryShareUserIDs(ctx, `SELECT user_id FROM plan_shares WHERE plan_id = ? ORDER BY created_at`, planID)
}

func (r *SQLiteRepository) PlanShareCounts(ctx context.Context, ownerID int64) (map[string]int, error) {
	return r.queryShareCounts(ctx, `SELECT plan_shares.plan_id, COUNT(*)
		FROM plan_shares JOIN training_plans ON training_plans.id = plan_shares.plan_id
		WHERE training_plans.user_id = ? GROUP BY plan_shares.plan_id`, ownerID)
}

func (r *SQLiteRepository) AddPlanShare(ctx context.Context, ownerID int64, planID string, targetID int64) error {
	if err := r.assertOwnsPlan(ctx, ownerID, planID); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO plan_shares (plan_id, user_id, created_at) VALUES (?,?,?)
		 ON CONFLICT (plan_id, user_id) DO NOTHING`, planID, targetID, now())
	if err != nil {
		return fmt.Errorf("add plan share: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) RemovePlanShare(ctx context.Context, ownerID int64, planID string, targetID int64) error {
	if err := r.assertOwnsPlan(ctx, ownerID, planID); err != nil {
		return err
	}
	if _, err := r.db.ExecContext(ctx,
		`DELETE FROM plan_shares WHERE plan_id = ? AND user_id = ?`, planID, targetID); err != nil {
		return fmt.Errorf("remove plan share: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) assertOwnsPlan(ctx context.Context, ownerID int64, planID string) error {
	var one int
	err := r.db.QueryRowContext(ctx,
		`SELECT 1 FROM training_plans WHERE id = ? AND user_id = ?`, planID, ownerID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("check plan owner: %w", err)
	}
	return nil
}

// --- Sessions ----------------------------------------------------------

func (r *SQLiteRepository) GetViewableSession(ctx context.Context, viewerID int64, id string) (*Session, error) {
	s, err := scanSession(r.db.QueryRowContext(ctx,
		`SELECT `+sessionCols+` FROM plan_sessions
		  WHERE id = ?
		    AND ( user_id = ?
		       OR visibility = ?
		       OR EXISTS (SELECT 1 FROM plan_session_shares WHERE plan_session_shares.session_id = plan_sessions.id
		                   AND plan_session_shares.user_id = ?) )`,
		id, viewerID, string(workout.VisibilityPublic), viewerID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get viewable session: %w", err)
	}
	return s, nil
}

func (r *SQLiteRepository) ListPublicSessions(ctx context.Context, viewerID int64) ([]Session, error) {
	return r.querySessionSummaries(ctx, `SELECT `+sessionCols+` FROM plan_sessions
		WHERE visibility = ? AND finished_at IS NOT NULL AND user_id <> ?
		ORDER BY started_at DESC`, string(workout.VisibilityPublic), viewerID)
}

func (r *SQLiteRepository) ListSharedSessionsWithMe(ctx context.Context, viewerID int64) ([]Session, error) {
	return r.querySessionSummaries(ctx, `SELECT `+sessionCols+` FROM plan_sessions
		WHERE id IN (SELECT session_id FROM plan_session_shares WHERE user_id = ?)
		  AND finished_at IS NOT NULL AND user_id <> ?
		ORDER BY started_at DESC`, viewerID, viewerID)
}

// ListSessionsSharedByMeWith mirrors ListPlansSharedByMeWith.
func (r *SQLiteRepository) ListSessionsSharedByMeWith(ctx context.Context, ownerID, recipientID int64) ([]Session, error) {
	return r.querySessionSummaries(ctx, `SELECT `+sessionCols+` FROM plan_sessions
		WHERE user_id = ?
		  AND id IN (SELECT session_id FROM plan_session_shares WHERE user_id = ?)
		ORDER BY started_at DESC`, ownerID, recipientID)
}

// SessionShareCounts maps session id to recipient count for the caller's own
// history, for the badge on each row.
func (r *SQLiteRepository) SessionShareCounts(ctx context.Context, ownerID int64) (map[string]int, error) {
	return r.queryShareCounts(ctx, `SELECT plan_session_shares.session_id, COUNT(*)
		FROM plan_session_shares
		JOIN plan_sessions ON plan_sessions.id = plan_session_shares.session_id
		WHERE plan_sessions.user_id = ? GROUP BY plan_session_shares.session_id`, ownerID)
}

// SessionShareRecipientsBySession mirrors PlanShareRecipientsByPlan.
func (r *SQLiteRepository) SessionShareRecipientsBySession(ctx context.Context, ownerID int64) (map[string][]int64, error) {
	return r.queryRecipientsByItem(ctx, `SELECT plan_session_shares.session_id, plan_session_shares.user_id
		FROM plan_session_shares
		JOIN plan_sessions ON plan_sessions.id = plan_session_shares.session_id
		WHERE plan_sessions.user_id = ?
		ORDER BY plan_session_shares.session_id, plan_session_shares.created_at`, ownerID)
}

func (r *SQLiteRepository) querySessionSummaries(ctx context.Context, query string, args ...any) ([]Session, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query sessions: %w", err)
	}
	defer rows.Close()
	out := make([]Session, 0)
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *s)
	}
	return out, rows.Err()
}

// SetSessionVisibility is guarded to finished sessions only at the row level
// — an unfinished one has no finished_at, and the WHERE below simply matches
// nothing for it, which the caller reads back as ErrNotFound. The service
// layer checks this too, with a clearer error, before ever reaching here.
func (r *SQLiteRepository) SetSessionVisibility(ctx context.Context, ownerID int64, id string, v workout.Visibility) error {
	res, err := r.db.ExecContext(ctx,
		`UPDATE plan_sessions SET visibility = ? WHERE id = ? AND user_id = ? AND finished_at IS NOT NULL`,
		string(v), id, ownerID)
	if err != nil {
		return fmt.Errorf("set session visibility: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SQLiteRepository) SessionShareRecipients(ctx context.Context, ownerID int64, sessionID string) ([]int64, error) {
	if err := r.assertOwnsSession(ctx, ownerID, sessionID); err != nil {
		return nil, err
	}
	return r.queryShareUserIDs(ctx,
		`SELECT user_id FROM plan_session_shares WHERE session_id = ? ORDER BY created_at`, sessionID)
}

func (r *SQLiteRepository) AddSessionShare(ctx context.Context, ownerID int64, sessionID string, targetID int64) error {
	// A share on an unfinished session would name a recipient before there is
	// anything for them to see, and finishing later would silently expose
	// whatever notes it grew in the meantime — assertOwnsFinishedSession is
	// what keeps this the same "finished only" rule the visibility toggle has.
	if err := r.assertOwnsFinishedSession(ctx, ownerID, sessionID); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO plan_session_shares (session_id, user_id, created_at) VALUES (?,?,?)
		 ON CONFLICT (session_id, user_id) DO NOTHING`, sessionID, targetID, now())
	if err != nil {
		return fmt.Errorf("add session share: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) RemoveSessionShare(ctx context.Context, ownerID int64, sessionID string, targetID int64) error {
	if err := r.assertOwnsSession(ctx, ownerID, sessionID); err != nil {
		return err
	}
	if _, err := r.db.ExecContext(ctx,
		`DELETE FROM plan_session_shares WHERE session_id = ? AND user_id = ?`, sessionID, targetID); err != nil {
		return fmt.Errorf("remove session share: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) assertOwnsSession(ctx context.Context, ownerID int64, sessionID string) error {
	var one int
	err := r.db.QueryRowContext(ctx,
		`SELECT 1 FROM plan_sessions WHERE id = ? AND user_id = ?`, sessionID, ownerID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("check session owner: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) assertOwnsFinishedSession(ctx context.Context, ownerID int64, sessionID string) error {
	var one int
	err := r.db.QueryRowContext(ctx,
		`SELECT 1 FROM plan_sessions WHERE id = ? AND user_id = ? AND finished_at IS NOT NULL`,
		sessionID, ownerID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return fmt.Errorf("check session owner: %w", err)
	}
	return nil
}

// --- shared helpers ------------------------------------------------------

func (r *SQLiteRepository) queryShareUserIDs(ctx context.Context, query string, args ...any) ([]int64, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
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

func (r *SQLiteRepository) queryRecipientsByItem(ctx context.Context, query string, args ...any) (map[string][]int64, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query share recipients: %w", err)
	}
	defer rows.Close()
	out := make(map[string][]int64)
	for rows.Next() {
		var (
			itemID string
			userID int64
		)
		if err := rows.Scan(&itemID, &userID); err != nil {
			return nil, err
		}
		out[itemID] = append(out[itemID], userID)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) queryShareCounts(ctx context.Context, query string, args ...any) (map[string]int, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query share counts: %w", err)
	}
	defer rows.Close()
	out := make(map[string]int)
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// DeleteSharesForUser removes every share naming userID as a recipient, on
// both tables. Called on account deletion — go-authkit deletes the account
// with a bare DELETE and neither share table has a foreign key to the users
// table (authkit owns it), so nothing else would catch these rows.
func (r *SQLiteRepository) DeleteSharesForUser(ctx context.Context, userID int64) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM plan_shares WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("delete plan shares for user: %w", err)
	}
	if _, err := r.db.ExecContext(ctx, `DELETE FROM plan_session_shares WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("delete session shares for user: %w", err)
	}
	return nil
}
