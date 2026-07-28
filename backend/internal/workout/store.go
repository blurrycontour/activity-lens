package workout

import (
	"bytes"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
	// ListSummary is like List but omits the route/HR/pace/elevation
	// timelines, which can be tens of KB each. List/dashboard views only
	// need the scalar summary fields, so this avoids deserializing (and
	// transferring) the full per-point series for every workout just to
	// render a card or a heatmap cell.
	ListSummary(ctx context.Context, userID int64) ([]Workout, error)
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
	elevation_gain, calories, steps, avg_pace, avg_speed, route, hr_timeline, pace_timeline,
	elev_timeline, cadence_timeline, notes, calories_manual, calories_reported, steps_manual`

const workoutSummaryCols = `id, user_id, name, type, start_time, duration, distance, avg_hr, max_hr,
	elevation_gain, calories, steps, avg_pace, avg_speed, notes, calories_manual, calories_reported, steps_manual`

func (r *SQLiteRepository) Create(ctx context.Context, w *Workout) error {
	s, err := marshalSeries(w)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = r.db.ExecContext(ctx, `INSERT INTO workouts (`+workoutCols+`, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		w.ID, w.UserID, w.Name, string(w.Type), w.StartTime.UTC().Format(time.RFC3339),
		w.Duration, w.Distance, w.AvgHR, w.MaxHR, w.ElevationGain, w.Calories, w.Steps,
		w.AvgPace, w.AvgSpeed, s.route, s.hr, s.pace, s.elev, s.cadence, w.Notes,
		boolToInt(w.CaloriesManual), boolToInt(w.CaloriesReported), boolToInt(w.StepsManual), now, now)
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

func (r *SQLiteRepository) ListSummary(ctx context.Context, userID int64) ([]Workout, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+workoutSummaryCols+` FROM workouts WHERE user_id = ? ORDER BY start_time DESC`, userID)
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

func (r *SQLiteRepository) Update(ctx context.Context, w *Workout) error {
	s, err := marshalSeries(w)
	if err != nil {
		return err
	}
	res, err := r.db.ExecContext(ctx, `UPDATE workouts SET name=?, type=?, start_time=?, duration=?,
		distance=?, avg_hr=?, max_hr=?, elevation_gain=?, calories=?, steps=?, avg_pace=?, avg_speed=?,
		route=?, hr_timeline=?, pace_timeline=?, elev_timeline=?, cadence_timeline=?, notes=?,
		calories_manual=?, calories_reported=?, steps_manual=?, updated_at=?
		WHERE id=? AND user_id=?`,
		w.Name, string(w.Type), w.StartTime.UTC().Format(time.RFC3339), w.Duration, w.Distance,
		w.AvgHR, w.MaxHR, w.ElevationGain, w.Calories, w.Steps, w.AvgPace, w.AvgSpeed,
		s.route, s.hr, s.pace, s.elev, s.cadence, w.Notes,
		boolToInt(w.CaloriesManual), boolToInt(w.CaloriesReported), boolToInt(w.StepsManual),
		time.Now().UTC().Format(time.RFC3339), w.ID, w.UserID)
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

// seriesBlobs holds the encoded per-point series of one workout, in the order
// they appear in workoutCols.
type seriesBlobs struct{ route, hr, pace, elev, cadence []byte }

// marshalSeries JSON-encodes and gzip-compresses each timeline. The JSON is
// highly repetitive (same few keys per point, smoothly changing numbers), so
// gzip typically shrinks it several-fold before it hits disk.
func marshalSeries(w *Workout) (seriesBlobs, error) {
	b := func(v any) ([]byte, error) {
		data, e := json.Marshal(v)
		if e != nil {
			return nil, fmt.Errorf("marshal series: %w", e)
		}
		return gzipBytes(data)
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
	if w.CadenceTimeline == nil {
		w.CadenceTimeline = []CadencePoint{}
	}
	var (
		s   seriesBlobs
		err error
	)
	for _, enc := range []struct {
		dst *[]byte
		src any
	}{
		{&s.route, w.Route}, {&s.hr, w.HRTimeline}, {&s.pace, w.PaceTimeline},
		{&s.elev, w.ElevTimeline}, {&s.cadence, w.CadenceTimeline},
	} {
		if *enc.dst, err = b(enc.src); err != nil {
			return seriesBlobs{}, err
		}
	}
	return s, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func gzipBytes(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	gw := gzip.NewWriter(&buf)
	if _, err := gw.Write(data); err != nil {
		return nil, fmt.Errorf("gzip series: %w", err)
	}
	if err := gw.Close(); err != nil {
		return nil, fmt.Errorf("gzip series: %w", err)
	}
	return buf.Bytes(), nil
}

// gunzipMaybe transparently decompresses gzip-magic-prefixed data. Rows
// written before gzip compression was introduced are stored as plain JSON
// text, so those are returned unchanged (backward compatible, no migration
// needed for existing data).
func gunzipMaybe(data []byte) ([]byte, error) {
	if len(data) < 2 || data[0] != 0x1f || data[1] != 0x8b {
		return data, nil
	}
	gr, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("gunzip series: %w", err)
	}
	defer gr.Close()
	out, err := io.ReadAll(gr)
	if err != nil {
		return nil, fmt.Errorf("gunzip series: %w", err)
	}
	return out, nil
}

func scanWorkout(row interface{ Scan(...any) error }) (*Workout, error) {
	var (
		w           Workout
		typ         string
		startTime   string
		s           seriesBlobs
		calManual   int
		calReported int
		stepManual  int
	)
	if err := row.Scan(&w.ID, &w.UserID, &w.Name, &typ, &startTime, &w.Duration, &w.Distance,
		&w.AvgHR, &w.MaxHR, &w.ElevationGain, &w.Calories, &w.Steps, &w.AvgPace, &w.AvgSpeed,
		&s.route, &s.hr, &s.pace, &s.elev, &s.cadence, &w.Notes,
		&calManual, &calReported, &stepManual); err != nil {
		return nil, err
	}
	w.CaloriesManual = calManual != 0
	w.CaloriesReported = calReported != 0
	w.StepsManual = stepManual != 0
	if err := applyScalarFields(&w, typ, startTime); err != nil {
		return nil, err
	}
	w.CadenceTimeline = []CadencePoint{}
	for _, dec := range []struct {
		src []byte
		dst any
	}{
		{s.route, &w.Route}, {s.hr, &w.HRTimeline}, {s.pace, &w.PaceTimeline},
		{s.elev, &w.ElevTimeline}, {s.cadence, &w.CadenceTimeline},
	} {
		if err := unmarshalInto(dec.src, dec.dst); err != nil {
			return nil, err
		}
	}
	return &w, nil
}

func scanWorkoutSummary(row interface{ Scan(...any) error }) (*Workout, error) {
	var (
		w           Workout
		typ         string
		startTime   string
		calManual   int
		calReported int
		stepManual  int
	)
	if err := row.Scan(&w.ID, &w.UserID, &w.Name, &typ, &startTime, &w.Duration, &w.Distance,
		&w.AvgHR, &w.MaxHR, &w.ElevationGain, &w.Calories, &w.Steps, &w.AvgPace, &w.AvgSpeed, &w.Notes,
		&calManual, &calReported, &stepManual); err != nil {
		return nil, err
	}
	w.CaloriesManual = calManual != 0
	w.CaloriesReported = calReported != 0
	w.StepsManual = stepManual != 0
	if err := applyScalarFields(&w, typ, startTime); err != nil {
		return nil, err
	}
	w.Route = []LatLng{}
	w.HRTimeline = []HRPoint{}
	w.PaceTimeline = []PacePoint{}
	w.ElevTimeline = []ElevPoint{}
	w.CadenceTimeline = []CadencePoint{}
	return &w, nil
}

func applyScalarFields(w *Workout, typ, startTime string) error {
	w.Type = Type(typ)
	t, err := time.Parse(time.RFC3339, startTime)
	if err != nil {
		return fmt.Errorf("parse start_time: %w", err)
	}
	w.StartTime = t
	w.Date = t.Format("2006-01-02")
	return nil
}

func unmarshalInto(data []byte, v any) error {
	if len(data) == 0 {
		return nil
	}
	raw, err := gunzipMaybe(data)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, v); err != nil {
		return fmt.Errorf("unmarshal series: %w", err)
	}
	return nil
}
