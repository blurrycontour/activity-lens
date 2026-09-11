package vitals

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ErrNotFound is returned when a measurement does not exist (or is not owned by
// the requesting user).
var ErrNotFound = errors.New("vitals: not found")

// Repository is the persistence seam for body vitals.
type Repository interface {
	Create(ctx context.Context, v *Vital) error
	// List returns a user's measurements newest first, optionally limited to
	// those on or after since (a zero time means all of them).
	List(ctx context.Context, userID int64, since time.Time) ([]Vital, error)
	Delete(ctx context.Context, userID int64, id string) error
	// LatestWeight returns the most recent weight reading, or nil when the user
	// has never recorded one.
	LatestWeight(ctx context.Context, userID int64) (*float64, error)
	// DeleteAllForUser removes every measurement a user owns, for account
	// deletion.
	DeleteAllForUser(ctx context.Context, userID int64) error
}

// SQLiteRepository implements Repository on top of *sql.DB (SQLite dialect).
type SQLiteRepository struct {
	db *sql.DB
}

// NewSQLiteRepository builds a SQLite-backed vitals repository.
func NewSQLiteRepository(db *sql.DB) *SQLiteRepository { return &SQLiteRepository{db: db} }

const vitalCols = `id, user_id, measured_at, weight_kg, systolic, diastolic, pulse, note, created_at`

func (r *SQLiteRepository) Create(ctx context.Context, v *Vital) error {
	now := time.Now().UTC().Format(time.RFC3339)
	v.CreatedAt = now
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO body_vitals (`+vitalCols+`)
		 VALUES (?,?,?,?,?,?,?,?,?)`,
		v.ID, v.UserID, v.MeasuredAt, v.WeightKg, v.Systolic, v.Diastolic, v.Pulse, v.Note, now)
	if err != nil {
		return fmt.Errorf("insert vital: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) List(ctx context.Context, userID int64, since time.Time) ([]Vital, error) {
	query := `SELECT ` + vitalCols + ` FROM body_vitals WHERE user_id = ?`
	args := []any{userID}
	if !since.IsZero() {
		query += ` AND measured_at >= ?`
		args = append(args, since.UTC().Format(time.RFC3339))
	}
	query += ` ORDER BY measured_at DESC`
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query vitals: %w", err)
	}
	defer rows.Close()
	out := make([]Vital, 0)
	for rows.Next() {
		v, err := scanVital(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) Delete(ctx context.Context, userID int64, id string) error {
	res, err := r.db.ExecContext(ctx,
		`DELETE FROM body_vitals WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("delete vital: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SQLiteRepository) LatestWeight(ctx context.Context, userID int64) (*float64, error) {
	var kg sql.NullFloat64
	err := r.db.QueryRowContext(ctx,
		`SELECT weight_kg FROM body_vitals
		 WHERE user_id = ? AND weight_kg IS NOT NULL
		 ORDER BY measured_at DESC LIMIT 1`, userID).Scan(&kg)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("latest weight: %w", err)
	}
	if !kg.Valid {
		return nil, nil
	}
	return &kg.Float64, nil
}

func (r *SQLiteRepository) DeleteAllForUser(ctx context.Context, userID int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM body_vitals WHERE user_id = ?`, userID)
	if err != nil {
		return fmt.Errorf("delete user vitals: %w", err)
	}
	return nil
}

// scanner is satisfied by both *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

func scanVital(s scanner) (*Vital, error) {
	var (
		v         Vital
		weight    sql.NullFloat64
		systolic  sql.NullInt64
		diastolic sql.NullInt64
		pulse     sql.NullInt64
	)
	if err := s.Scan(&v.ID, &v.UserID, &v.MeasuredAt, &weight, &systolic, &diastolic, &pulse, &v.Note, &v.CreatedAt); err != nil {
		return nil, err
	}
	if weight.Valid {
		v.WeightKg = &weight.Float64
	}
	if systolic.Valid {
		n := int(systolic.Int64)
		v.Systolic = &n
	}
	if diastolic.Valid {
		n := int(diastolic.Int64)
		v.Diastolic = &n
	}
	if pulse.Valid {
		n := int(pulse.Int64)
		v.Pulse = &n
	}
	return &v, nil
}
