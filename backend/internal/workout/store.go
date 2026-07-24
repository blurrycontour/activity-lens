package workout

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// ErrNotFound is returned when a workout does not exist (or is not owned by the
// requesting user).
var ErrNotFound = errors.New("workout: not found")

// Repository is the persistence seam for workouts. All SQL lives behind this
// interface so an alternative backend (Postgres, encrypted SQLite) can be
// dropped in without changing the service.
type Repository interface {
	Create(ctx context.Context, w *Workout) error
	Get(ctx context.Context, userID int64, id string) (*Workout, error)
	List(ctx context.Context, userID int64) ([]Workout, error)
	Update(ctx context.Context, w *Workout) error
	Delete(ctx context.Context, userID int64, id string) error
}

// SQLiteRepository implements Repository on top of *sql.DB (SQLite dialect).
type SQLiteRepository struct {
	db *sql.DB
}

// NewSQLiteRepository builds a SQLite-backed workout repository.
func NewSQLiteRepository(db *sql.DB) *SQLiteRepository { return &SQLiteRepository{db: db} }

const workoutCols = `id, user_id, name, type, start_time, duration, distance, avg_hr, max_hr,
	elevation_gain, calories, avg_pace, avg_speed, route, hr_timeline, pace_timeline,
	elev_timeline, notes`

func (r *SQLiteRepository) Create(ctx context.Context, w *Workout) error {
	route, hr, pace, elev, err := marshalSeries(w)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = r.db.ExecContext(ctx, `INSERT INTO workouts (`+workoutCols+`, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		w.ID, w.UserID, w.Name, string(w.Type), w.StartTime.UTC().Format(time.RFC3339),
		w.Duration, w.Distance, w.AvgHR, w.MaxHR, w.ElevationGain, w.Calories,
		w.AvgPace, w.AvgSpeed, route, hr, pace, elev, w.Notes, now, now)
	if err != nil {
		return fmt.Errorf("insert workout: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) Get(ctx context.Context, userID int64, id string) (*Workout, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+workoutCols+` FROM workouts WHERE id = ? AND user_id = ?`, id, userID)
	w, err := scanWorkout(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return w, err
}

func (r *SQLiteRepository) List(ctx context.Context, userID int64) ([]Workout, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+workoutCols+` FROM workouts WHERE user_id = ? ORDER BY start_time DESC`, userID)
	if err != nil {
		return nil, fmt.Errorf("query workouts: %w", err)
	}
	defer rows.Close()
	out := make([]Workout, 0)
	for rows.Next() {
		w, err := scanWorkout(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *w)
	}
	return out, rows.Err()
}

func (r *SQLiteRepository) Update(ctx context.Context, w *Workout) error {
	route, hr, pace, elev, err := marshalSeries(w)
	if err != nil {
		return err
	}
	res, err := r.db.ExecContext(ctx, `UPDATE workouts SET name=?, type=?, start_time=?, duration=?,
		distance=?, avg_hr=?, max_hr=?, elevation_gain=?, calories=?, avg_pace=?, avg_speed=?,
		route=?, hr_timeline=?, pace_timeline=?, elev_timeline=?, notes=?, updated_at=?
		WHERE id=? AND user_id=?`,
		w.Name, string(w.Type), w.StartTime.UTC().Format(time.RFC3339), w.Duration, w.Distance,
		w.AvgHR, w.MaxHR, w.ElevationGain, w.Calories, w.AvgPace, w.AvgSpeed, route, hr, pace, elev,
		w.Notes, time.Now().UTC().Format(time.RFC3339), w.ID, w.UserID)
	if err != nil {
		return fmt.Errorf("update workout: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *SQLiteRepository) Delete(ctx context.Context, userID int64, id string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM workouts WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return fmt.Errorf("delete workout: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func marshalSeries(w *Workout) (route, hr, pace, elev string, err error) {
	b := func(v any) (string, error) {
		data, e := json.Marshal(v)
		if e != nil {
			return "", fmt.Errorf("marshal series: %w", e)
		}
		return string(data), nil
	}
	if w.Route == nil {
		w.Route = []LatLng{}
	}
	if w.HRTimeline == nil {
		w.HRTimeline = []HRPoint{}
	}
	if w.PaceTimeline == nil {
		w.PaceTimeline = []PacePoint{}
	}
	if w.ElevTimeline == nil {
		w.ElevTimeline = []ElevPoint{}
	}
	if route, err = b(w.Route); err != nil {
		return
	}
	if hr, err = b(w.HRTimeline); err != nil {
		return
	}
	if pace, err = b(w.PaceTimeline); err != nil {
		return
	}
	elev, err = b(w.ElevTimeline)
	return
}

func scanWorkout(row interface{ Scan(...any) error }) (*Workout, error) {
	var (
		w          Workout
		typ        string
		startTime  string
		route, hr  string
		pace, elev string
	)
	if err := row.Scan(&w.ID, &w.UserID, &w.Name, &typ, &startTime, &w.Duration, &w.Distance,
		&w.AvgHR, &w.MaxHR, &w.ElevationGain, &w.Calories, &w.AvgPace, &w.AvgSpeed,
		&route, &hr, &pace, &elev, &w.Notes); err != nil {
		return nil, err
	}
	w.Type = Type(typ)
	t, err := time.Parse(time.RFC3339, startTime)
	if err != nil {
		return nil, fmt.Errorf("parse start_time: %w", err)
	}
	w.StartTime = t
	w.Date = t.Format("2006-01-02")
	if err := unmarshalInto(route, &w.Route); err != nil {
		return nil, err
	}
	if err := unmarshalInto(hr, &w.HRTimeline); err != nil {
		return nil, err
	}
	if err := unmarshalInto(pace, &w.PaceTimeline); err != nil {
		return nil, err
	}
	if err := unmarshalInto(elev, &w.ElevTimeline); err != nil {
		return nil, err
	}
	return &w, nil
}

func unmarshalInto(s string, v any) error {
	if s == "" {
		return nil
	}
	if err := json.Unmarshal([]byte(s), v); err != nil {
		return fmt.Errorf("unmarshal series: %w", err)
	}
	return nil
}
