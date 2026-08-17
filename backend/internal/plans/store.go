package plans

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ErrNotFound is returned when a plan or session does not exist, or is not
// owned by the requesting user. The two are deliberately indistinguishable
// from outside: telling someone that a plan exists but is not theirs is still
// telling them it exists.
var ErrNotFound = errors.New("plans: not found")

// Repository is the persistence seam for training plans.
type Repository interface {
	CreatePlan(ctx context.Context, p *Plan) error
	GetPlan(ctx context.Context, userID int64, id string) (*Plan, error)
	ListPlans(ctx context.Context, userID int64) ([]Plan, error)
	UpdatePlan(ctx context.Context, p *Plan) error
	DeletePlan(ctx context.Context, userID int64, id string) error
	// ReplaceDays swaps a plan's entire day structure for days, in one
	// transaction. See the method comment for why the editor writes whole
	// rather than in pieces.
	ReplaceDays(ctx context.Context, userID int64, planID string, days []Day) error

	CreateSession(ctx context.Context, s *Session) error
	GetSession(ctx context.Context, userID int64, id string) (*Session, error)
	// ActiveSession returns the user's unfinished session, or ErrNotFound.
	ActiveSession(ctx context.Context, userID int64) (*Session, error)
	UpdateSession(ctx context.Context, s *Session) error
	ListSessions(ctx context.Context, userID int64, limit, offset int) ([]Session, error)
	DeleteSession(ctx context.Context, userID int64, id string) error

	// DeleteAllForUser removes every plan and session a user owns, for
	// account deletion.
	DeleteAllForUser(ctx context.Context, userID int64) error
}

// SQLiteRepository implements Repository on top of *sql.DB (SQLite dialect).
type SQLiteRepository struct {
	db *sql.DB
}

// NewSQLiteRepository builds a SQLite-backed plans repository.
func NewSQLiteRepository(db *sql.DB) *SQLiteRepository { return &SQLiteRepository{db: db} }

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

// --- Plans ---------------------------------------------------------------

func (r *SQLiteRepository) CreatePlan(ctx context.Context, p *Plan) error {
	ts := now()
	p.CreatedAt, p.UpdatedAt = ts, ts
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO training_plans (id, user_id, name, notes, archived, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?)`,
		p.ID, p.UserID, p.Name, p.Notes, boolToInt(p.Archived), ts, ts)
	if err != nil {
		return fmt.Errorf("insert plan: %w", err)
	}
	return nil
}

// planCols carries the two aggregates the list page shows beside each plan.
// Both are correlated subqueries over small indexed tables, which keeps the
// list a single round trip instead of one query per plan.
const planCols = `p.id, p.user_id, p.name, p.notes, p.archived, p.created_at, p.updated_at,
	(SELECT COUNT(*) FROM plan_days d WHERE d.plan_id = p.id) AS day_count,
	(SELECT COALESCE(MAX(s.started_at), '') FROM plan_sessions s WHERE s.plan_id = p.id) AS last_session_at`

func scanPlan(row interface{ Scan(...any) error }) (*Plan, error) {
	var p Plan
	var archived int
	if err := row.Scan(&p.ID, &p.UserID, &p.Name, &p.Notes, &archived,
		&p.CreatedAt, &p.UpdatedAt, &p.DayCount, &p.LastSessionAt); err != nil {
		return nil, err
	}
	p.Archived = archived != 0
	return &p, nil
}

func (r *SQLiteRepository) GetPlan(ctx context.Context, userID int64, id string) (*Plan, error) {
	p, err := scanPlan(r.db.QueryRowContext(ctx,
		`SELECT `+planCols+` FROM training_plans p WHERE p.id = ? AND p.user_id = ?`, id, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get plan: %w", err)
	}
	days, err := r.loadDays(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	p.Days = days
	return p, nil
}

// loadDays reads a plan's whole structure in three queries — days, blocks,
// exercises — and stitches it together in memory.
//
// Not one query per day and not a single wide join: a plan is a handful of
// days holding a few dozen exercises, so three indexed scans is both fewer
// round trips than walking the tree and less work than de-duplicating the
// cartesian product a three-level join returns.
func (r *SQLiteRepository) loadDays(ctx context.Context, planID string) ([]Day, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, name FROM plan_days WHERE plan_id = ? ORDER BY position, id`, planID)
	if err != nil {
		return nil, fmt.Errorf("list days: %w", err)
	}
	defer rows.Close()

	var days []Day
	byDay := map[string]int{}
	for rows.Next() {
		var d Day
		if err := rows.Scan(&d.ID, &d.Name); err != nil {
			return nil, fmt.Errorf("scan day: %w", err)
		}
		d.Blocks = []Block{}
		byDay[d.ID] = len(days)
		days = append(days, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(days) == 0 {
		return []Day{}, nil
	}

	blockRows, err := r.db.QueryContext(ctx,
		`SELECT b.id, b.day_id, b.rest_sec FROM plan_blocks b
		   JOIN plan_days d ON d.id = b.day_id
		  WHERE d.plan_id = ? ORDER BY b.position, b.id`, planID)
	if err != nil {
		return nil, fmt.Errorf("list blocks: %w", err)
	}
	defer blockRows.Close()

	// Where each block landed, so the exercise pass can find it in one lookup.
	type at struct{ day, block int }
	byBlock := map[string]at{}
	for blockRows.Next() {
		var id, dayID string
		var restSec int
		if err := blockRows.Scan(&id, &dayID, &restSec); err != nil {
			return nil, fmt.Errorf("scan block: %w", err)
		}
		di, ok := byDay[dayID]
		if !ok {
			continue
		}
		byBlock[id] = at{di, len(days[di].Blocks)}
		days[di].Blocks = append(days[di].Blocks, Block{ID: id, Options: []Exercise{}, RestSec: restSec})
	}
	if err := blockRows.Err(); err != nil {
		return nil, err
	}
	if len(byBlock) == 0 {
		return days, nil
	}

	exRows, err := r.db.QueryContext(ctx,
		`SELECT e.id, e.block_id, e.name, e.sets, e.reps, e.weight_kg, e.rest_sec, e.note
		   FROM plan_exercises e
		   JOIN plan_blocks b ON b.id = e.block_id
		   JOIN plan_days d ON d.id = b.day_id
		  WHERE d.plan_id = ? ORDER BY e.position, e.id`, planID)
	if err != nil {
		return nil, fmt.Errorf("list exercises: %w", err)
	}
	defer exRows.Close()

	for exRows.Next() {
		var e Exercise
		var blockID string
		if err := exRows.Scan(&e.ID, &blockID, &e.Name, &e.Sets, &e.Reps, &e.WeightKg, &e.RestSec, &e.Note); err != nil {
			return nil, fmt.Errorf("scan exercise: %w", err)
		}
		pos, ok := byBlock[blockID]
		if !ok {
			continue
		}
		b := &days[pos.day].Blocks[pos.block]
		b.Options = append(b.Options, e)
	}
	return days, exRows.Err()
}

func (r *SQLiteRepository) ListPlans(ctx context.Context, userID int64) ([]Plan, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+planCols+` FROM training_plans p
		  WHERE p.user_id = ? ORDER BY p.archived, p.updated_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("list plans: %w", err)
	}
	defer rows.Close()

	list := []Plan{}
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, fmt.Errorf("scan plan: %w", err)
		}
		list = append(list, *p)
	}
	return list, rows.Err()
}

func (r *SQLiteRepository) UpdatePlan(ctx context.Context, p *Plan) error {
	p.UpdatedAt = now()
	res, err := r.db.ExecContext(ctx,
		`UPDATE training_plans SET name = ?, notes = ?, archived = ?, updated_at = ?
		  WHERE id = ? AND user_id = ?`,
		p.Name, p.Notes, boolToInt(p.Archived), p.UpdatedAt, p.ID, p.UserID)
	if err != nil {
		return fmt.Errorf("update plan: %w", err)
	}
	return affected(res)
}

func (r *SQLiteRepository) DeletePlan(ctx context.Context, userID int64, id string) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM training_plans WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("delete plan: %w", err)
	}
	return affected(res)
}

func affected(res sql.Result) error {
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ReplaceDays rewrites a plan's whole structure in one transaction.
//
// The editor saves the day it is editing rather than diffing individual rows,
// so this deletes and reinserts. That sounds heavy and is not: a plan is a few
// dozen rows behind indexed foreign keys, and the alternative — per-row
// create/update/delete/reorder endpoints — is roughly ten times the code and
// the place where a half-applied edit becomes possible. One statement per
// level keeps it a handful of queries regardless of size.
//
// Ids supplied by the caller are kept, which is what lets an in-progress
// session still match its blocks after the plan behind it is edited.
func (r *SQLiteRepository) ReplaceDays(ctx context.Context, userID int64, planID string, days []Day) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Ownership is checked inside the transaction, so a plan deleted between
	// the check and the write cannot leave orphaned days behind.
	var owned int
	if err := tx.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM training_plans WHERE id = ? AND user_id = ?`, planID, userID).Scan(&owned); err != nil {
		return fmt.Errorf("check plan: %w", err)
	}
	if owned == 0 {
		return ErrNotFound
	}

	// The two child levels go with the days by ON DELETE CASCADE.
	if _, err := tx.ExecContext(ctx, `DELETE FROM plan_days WHERE plan_id = ?`, planID); err != nil {
		return fmt.Errorf("clear days: %w", err)
	}

	for di, d := range days {
		if _, err := tx.ExecContext(ctx,
			`INSERT INTO plan_days (id, plan_id, name, position) VALUES (?,?,?,?)`,
			d.ID, planID, d.Name, di); err != nil {
			return fmt.Errorf("insert day: %w", err)
		}
		for bi, b := range d.Blocks {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO plan_blocks (id, day_id, position, rest_sec) VALUES (?,?,?,?)`,
				b.ID, d.ID, bi, b.RestSec); err != nil {
				return fmt.Errorf("insert block: %w", err)
			}
			for ei, e := range b.Options {
				if _, err := tx.ExecContext(ctx,
					`INSERT INTO plan_exercises (id, block_id, position, name, sets, reps, weight_kg, rest_sec, note)
					 VALUES (?,?,?,?,?,?,?,?,?)`,
					e.ID, b.ID, ei, e.Name, e.Sets, e.Reps, e.WeightKg, e.RestSec, e.Note); err != nil {
					return fmt.Errorf("insert exercise: %w", err)
				}
			}
		}
	}

	if _, err := tx.ExecContext(ctx,
		`UPDATE training_plans SET updated_at = ? WHERE id = ?`, now(), planID); err != nil {
		return fmt.Errorf("touch plan: %w", err)
	}
	return tx.Commit()
}

// --- Sessions ------------------------------------------------------------

const sessionCols = `id, user_id, COALESCE(plan_id, ''), plan_name, day_name, started_at,
	COALESCE(finished_at, ''), snapshot, progress, done_sets, total_sets, volume_kg,
	notes, COALESCE(workout_id, '')`

func scanSession(row interface{ Scan(...any) error }) (*Session, error) {
	var s Session
	var snapshot, progress string
	if err := row.Scan(&s.ID, &s.UserID, &s.PlanID, &s.PlanName, &s.DayName, &s.StartedAt,
		&s.FinishedAt, &snapshot, &progress, &s.DoneSets, &s.TotalSets, &s.VolumeKg,
		&s.Notes, &s.WorkoutID); err != nil {
		return nil, err
	}
	// A snapshot that will not parse is a bug on the way in, not a reason to
	// fail the read: the session's own totals are columns and still render.
	_ = json.Unmarshal([]byte(snapshot), &s.Snapshot)
	_ = json.Unmarshal([]byte(progress), &s.Progress)
	if s.Progress.Blocks == nil {
		s.Progress.Blocks = map[string]BlockProgress{}
	}
	return &s, nil
}

func (r *SQLiteRepository) CreateSession(ctx context.Context, s *Session) error {
	snapshot, err := json.Marshal(s.Snapshot)
	if err != nil {
		return fmt.Errorf("encode snapshot: %w", err)
	}
	progress, err := json.Marshal(s.Progress)
	if err != nil {
		return fmt.Errorf("encode progress: %w", err)
	}
	_, err = r.db.ExecContext(ctx,
		`INSERT INTO plan_sessions
		   (id, user_id, plan_id, plan_name, day_name, started_at, finished_at,
		    snapshot, progress, done_sets, total_sets, volume_kg, notes, workout_id)
		 VALUES (?,?,?,?,?,?,NULL,?,?,?,?,?,?,NULL)`,
		s.ID, s.UserID, nullable(s.PlanID), s.PlanName, s.DayName, s.StartedAt,
		string(snapshot), string(progress), s.DoneSets, s.TotalSets, s.VolumeKg, s.Notes)
	if err != nil {
		return fmt.Errorf("insert session: %w", err)
	}
	return nil
}

// nullable maps the empty string to SQL NULL, so that "no plan" and "no
// workout" are absent rather than a row pointing at an id of "".
func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (r *SQLiteRepository) GetSession(ctx context.Context, userID int64, id string) (*Session, error) {
	s, err := scanSession(r.db.QueryRowContext(ctx,
		`SELECT `+sessionCols+` FROM plan_sessions WHERE id = ? AND user_id = ?`, id, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("get session: %w", err)
	}
	return s, nil
}

func (r *SQLiteRepository) ActiveSession(ctx context.Context, userID int64) (*Session, error) {
	s, err := scanSession(r.db.QueryRowContext(ctx,
		`SELECT `+sessionCols+` FROM plan_sessions
		  WHERE user_id = ? AND finished_at IS NULL
		  ORDER BY started_at DESC LIMIT 1`, userID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("active session: %w", err)
	}
	return s, nil
}

func (r *SQLiteRepository) UpdateSession(ctx context.Context, s *Session) error {
	progress, err := json.Marshal(s.Progress)
	if err != nil {
		return fmt.Errorf("encode progress: %w", err)
	}
	res, err := r.db.ExecContext(ctx,
		`UPDATE plan_sessions
		    SET progress = ?, finished_at = ?, done_sets = ?, total_sets = ?,
		        volume_kg = ?, notes = ?, workout_id = ?
		  WHERE id = ? AND user_id = ?`,
		string(progress), nullable(s.FinishedAt), s.DoneSets, s.TotalSets,
		s.VolumeKg, s.Notes, nullable(s.WorkoutID), s.ID, s.UserID)
	if err != nil {
		return fmt.Errorf("update session: %w", err)
	}
	return affected(res)
}

func (r *SQLiteRepository) ListSessions(ctx context.Context, userID int64, limit, offset int) ([]Session, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+sessionCols+` FROM plan_sessions
		  WHERE user_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`,
		userID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	list := []Session{}
	for rows.Next() {
		s, err := scanSession(rows)
		if err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		list = append(list, *s)
	}
	return list, rows.Err()
}

func (r *SQLiteRepository) DeleteSession(ctx context.Context, userID int64, id string) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM plan_sessions WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return affected(res)
}

func (r *SQLiteRepository) DeleteAllForUser(ctx context.Context, userID int64) error {
	// Days, blocks and exercises follow their plan by ON DELETE CASCADE.
	if _, err := r.db.ExecContext(ctx, `DELETE FROM plan_sessions WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("delete user sessions: %w", err)
	}
	if _, err := r.db.ExecContext(ctx, `DELETE FROM training_plans WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("delete user plans: %w", err)
	}
	return nil
}
