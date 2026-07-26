package equipment

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// ErrNotFound is returned when equipment does not exist (or is not owned by the
// requesting user).
var ErrNotFound = errors.New("equipment: not found")

// Repository is the persistence seam for equipment.
type Repository interface {
	Create(ctx context.Context, e *Equipment) error
	Get(ctx context.Context, userID int64, id string) (*Equipment, error)
	List(ctx context.Context, userID int64) ([]Equipment, error)
	Update(ctx context.Context, e *Equipment) error
	Delete(ctx context.Context, userID int64, id string) error
	// LinkedWorkouts returns summaries of the workouts a piece of equipment is
	// associated with, newest first.
	LinkedWorkouts(ctx context.Context, userID int64, equipmentID string) ([]LinkedWorkout, error)
	// SetWorkoutEquipment replaces the set of equipment linked to a workout
	// with ids (only ids owned by userID are honoured).
	SetWorkoutEquipment(ctx context.Context, userID int64, workoutID string, ids []string) error
	// ForWorkout returns the equipment linked to a workout.
	ForWorkout(ctx context.Context, userID int64, workoutID string) ([]Equipment, error)
}

// SQLiteRepository implements Repository on top of *sql.DB (SQLite dialect).
type SQLiteRepository struct {
	db *sql.DB
}

// NewSQLiteRepository builds a SQLite-backed equipment repository.
func NewSQLiteRepository(db *sql.DB) *SQLiteRepository { return &SQLiteRepository{db: db} }

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func (r *SQLiteRepository) Create(ctx context.Context, e *Equipment) error {
	now := time.Now().UTC().Format(time.RFC3339)
	e.CreatedAt = now
	e.UpdatedAt = now
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO equipment (id, user_id, name, type, brand, model, notes, retired, created_at, updated_at)
		 VALUES (?,?,?,?,?,?,?,?,?,?)`,
		e.ID, e.UserID, e.Name, e.Type, e.Brand, e.Model, e.Notes, boolToInt(e.Retired), now, now)
	if err != nil {
		return fmt.Errorf("insert equipment: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) Get(ctx context.Context, userID int64, id string) (*Equipment, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT e.id, e.user_id, e.name, e.type, e.brand, e.model, e.notes, e.retired, e.created_at, e.updated_at,
		        (SELECT COUNT(*) FROM workout_equipment we WHERE we.equipment_id = e.id) AS workout_count
		 FROM equipment e WHERE e.id = ? AND e.user_id = ?`, id, userID)
	e, err := scanEquipment(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

func (r *SQLiteRepository) List(ctx context.Context, userID int64) ([]Equipment, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT e.id, e.user_id, e.name, e.type, e.brand, e.model, e.notes, e.retired, e.created_at, e.updated_at,
		        (SELECT COUNT(*) FROM workout_equipment we WHERE we.equipment_id = e.id) AS workout_count
		 FROM equipment e WHERE e.user_id = ? ORDER BY e.retired ASC, e.created_at DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("query equipment: %w", err)
	}
	defer rows.Close()
	out := make([]Equipment, 0)
	for rows.Next() {
		e, err := scanEquipment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) Update(ctx context.Context, e *Equipment) error {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := r.db.ExecContext(ctx,
		`UPDATE equipment SET name=?, type=?, brand=?, model=?, notes=?, retired=?, updated_at=?
		 WHERE id=? AND user_id=?`,
		e.Name, e.Type, e.Brand, e.Model, e.Notes, boolToInt(e.Retired), now, e.ID, e.UserID)
	if err != nil {
		return fmt.Errorf("update equipment: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	e.UpdatedAt = now
	return nil
}

func (r *SQLiteRepository) Delete(ctx context.Context, userID int64, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM equipment WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("delete equipment: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SQLiteRepository) LinkedWorkouts(ctx context.Context, userID int64, equipmentID string) ([]LinkedWorkout, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT w.id, w.name, w.type, w.start_time, w.distance, w.duration
		 FROM workout_equipment we
		 JOIN workouts w ON w.id = we.workout_id
		 WHERE we.equipment_id = ? AND w.user_id = ?
		 ORDER BY w.start_time DESC`, equipmentID, userID)
	if err != nil {
		return nil, fmt.Errorf("query linked workouts: %w", err)
	}
	defer rows.Close()
	out := make([]LinkedWorkout, 0)
	for rows.Next() {
		var lw LinkedWorkout
		var startTime string
		if err := rows.Scan(&lw.ID, &lw.Name, &lw.Type, &startTime, &lw.Distance, &lw.Duration); err != nil {
			return nil, err
		}
		if t, err := time.Parse(time.RFC3339, startTime); err == nil {
			lw.Date = t.Format("2006-01-02")
		}
		out = append(out, lw)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) ForWorkout(ctx context.Context, userID int64, workoutID string) ([]Equipment, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT e.id, e.user_id, e.name, e.type, e.brand, e.model, e.notes, e.retired, e.created_at, e.updated_at, 0
		 FROM workout_equipment we
		 JOIN equipment e ON e.id = we.equipment_id
		 WHERE we.workout_id = ? AND e.user_id = ?
		 ORDER BY e.name ASC`, workoutID, userID)
	if err != nil {
		return nil, fmt.Errorf("query workout equipment: %w", err)
	}
	defer rows.Close()
	out := make([]Equipment, 0)
	for rows.Next() {
		e, err := scanEquipment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *e)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) SetWorkoutEquipment(ctx context.Context, userID int64, workoutID string, ids []string) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DELETE FROM workout_equipment WHERE workout_id = ?`, workoutID); err != nil {
		return fmt.Errorf("clear workout equipment: %w", err)
	}
	for _, id := range ids {
		// Only link equipment the user actually owns.
		var owned int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM equipment WHERE id = ? AND user_id = ?`, id, userID).Scan(&owned); err != nil {
			return err
		}
		if owned == 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx,
			`INSERT OR IGNORE INTO workout_equipment (workout_id, equipment_id) VALUES (?, ?)`, workoutID, id); err != nil {
			return fmt.Errorf("link equipment: %w", err)
		}
	}
	return tx.Commit()
}

// scanner abstracts *sql.Row and *sql.Rows for scanEquipment.
type scanner interface {
	Scan(dest ...any) error
}

func scanEquipment(s scanner) (*Equipment, error) {
	var e Equipment
	var retired int
	if err := s.Scan(&e.ID, &e.UserID, &e.Name, &e.Type, &e.Brand, &e.Model, &e.Notes, &retired, &e.CreatedAt, &e.UpdatedAt, &e.WorkoutCount); err != nil {
		return nil, err
	}
	e.Retired = retired != 0
	return &e, nil
}
