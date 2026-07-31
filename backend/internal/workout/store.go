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
	"strings"
	"time"
)

// ErrNotFound is returned when a workout does not exist (or is not owned by the
// requesting user).
var ErrNotFound = errors.New("workout: not found")

// ErrDuplicate is returned when an insert collides with an existing workout
// carrying the same (user, source, external id) identity.
var ErrDuplicate = errors.New("workout: duplicate")

// Repository is the persistence seam for workouts. All SQL lives behind this
// interface so an alternative backend (Postgres, encrypted SQLite) can be
// dropped in without changing the service.
type Repository interface {
	Create(ctx context.Context, w *Workout) error
	Get(ctx context.Context, userID int64, id string) (*Workout, error)
	// GetByExternalID looks a workout up by its (source, external id) identity
	// so an import can detect that it has already stored this workout.
	// Returns ErrNotFound when there is no match.
	GetByExternalID(ctx context.Context, userID int64, source Source, externalID string) (*Workout, error)
	List(ctx context.Context, userID int64) ([]Workout, error)
	// ListSummary is like List but omits the route/HR/pace/elevation
	// timelines, which can be tens of KB each. List/dashboard views only
	// need the scalar summary fields, so this avoids deserializing (and
	// transferring) the full per-point series for every workout just to
	// render a card or a heatmap cell.
	ListSummary(ctx context.Context, userID int64) ([]Workout, error)
	Update(ctx context.Context, w *Workout) error
	Delete(ctx context.Context, userID int64, id string) error

	// GetViewable returns a workout viewerID is allowed to read: their own, a
	// public one, or one shared directly with them. It is the only read path
	// that crosses ownership — every other method stays owner-scoped, so a
	// forgotten check fails closed with ErrNotFound rather than leaking.
	GetViewable(ctx context.Context, viewerID int64, id string) (*Workout, error)
	// ListPublicSummary returns other users' public workouts, newest first.
	ListPublicSummary(ctx context.Context, viewerID int64) ([]Workout, error)
	// ListSharedWithMeSummary returns workouts shared directly with viewerID.
	ListSharedWithMeSummary(ctx context.Context, viewerID int64) ([]Workout, error)
	// SetVisibility flips a workout the caller owns; ErrNotFound otherwise.
	SetVisibility(ctx context.Context, ownerID int64, id string, v Visibility) error
	// ShareRecipients lists the user ids a workout the caller owns is shared
	// with, oldest share first.
	ShareRecipients(ctx context.Context, ownerID int64, workoutID string) ([]int64, error)
	// ShareCounts maps workout id to recipient count across everything ownerID
	// owns, in one query, so listing a library never fans out per row.
	ShareCounts(ctx context.Context, ownerID int64) (map[string]int, error)
	// AddShare is idempotent. Both AddShare and RemoveShare return ErrNotFound
	// when the caller does not own the workout.
	AddShare(ctx context.Context, ownerID int64, workoutID string, targetID int64) error
	RemoveShare(ctx context.Context, ownerID int64, workoutID string, targetID int64) error
	// DeleteSharesForUser removes every share row naming a user, for cleanup
	// when that account is deleted.
	DeleteSharesForUser(ctx context.Context, userID int64) error
	// DeleteAllForUser removes every workout a user owns and returns the ids it
	// deleted, for cleanup when that account is deleted.
	DeleteAllForUser(ctx context.Context, userID int64) ([]string, error)
	// SetRawFilename records the name of the file a workout was imported from,
	// once its original has been archived to disk.
	SetRawFilename(ctx context.Context, workoutID, filename string) error
	// ImportWindow returns when the newest and the nth newest workout from a
	// given source entered the library, so a batch of n imports can be described
	// as a closed interval rather than as everything since a moment.
	ImportWindow(ctx context.Context, userID int64, source Source, n int) (start, end time.Time, err error)

	// KnownContentHashes returns the subset of hashes the user has already
	// imported, so a client can skip uploading files that would only dedupe.
	KnownContentHashes(ctx context.Context, userID int64, hashes []string) ([]string, error)
}

// SQLiteRepository implements Repository on top of *sql.DB (SQLite dialect).
type SQLiteRepository struct {
	db *sql.DB
}

// NewSQLiteRepository builds a SQLite-backed workout repository.
func NewSQLiteRepository(db *sql.DB) *SQLiteRepository { return &SQLiteRepository{db: db} }

const workoutCols = `id, user_id, name, type, start_time, duration, distance, avg_hr, max_hr,
	elevation_gain, calories, steps, avg_pace, avg_speed, route, hr_timeline, pace_timeline,
	elev_timeline, cadence_timeline, notes, calories_manual, calories_reported, steps_manual, source`

const workoutSummaryCols = `id, user_id, name, type, start_time, duration, distance, avg_hr, max_hr,
	elevation_gain, calories, steps, avg_pace, avg_speed, notes, calories_manual, calories_reported,
	steps_manual, source`

// insertCols extends workoutCols with the de-duplication identity, which is
// written on insert but never read back into the model on normal reads.
const insertCols = workoutCols + `, external_id, content_hash`

// Selection column sets add visibility, which reads back into the model but is
// deliberately absent from insertCols and from the UPDATE in Update: sharing
// state has its own method, so no create or patch path can ever change it.
const (
	selectCols        = workoutCols + `, visibility, raw_filename, created_at`
	selectSummaryCols = workoutSummaryCols + `, visibility, created_at`
)

func (r *SQLiteRepository) Create(ctx context.Context, w *Workout) error {
	s, err := marshalSeries(w)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = r.db.ExecContext(ctx, `INSERT INTO workouts (`+insertCols+`, created_at, updated_at)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		w.ID, w.UserID, w.Name, string(w.Type), w.StartTime.UTC().Format(time.RFC3339),
		w.Duration, w.Distance, w.AvgHR, w.MaxHR, w.ElevationGain, w.Calories, w.Steps,
		w.AvgPace, w.AvgSpeed, s.route, s.hr, s.pace, s.elev, s.cadence, w.Notes,
		boolToInt(w.CaloriesManual), boolToInt(w.CaloriesReported), boolToInt(w.StepsManual),
		string(w.Source), nullIfEmpty(w.ExternalID), nullIfEmpty(w.ContentHash), now, now)
	if err != nil {
		if isUniqueViolation(err) {
			return ErrDuplicate
		}
		return fmt.Errorf("insert workout: %w", err)
	}
	return nil
}

func (r *SQLiteRepository) GetByExternalID(ctx context.Context, userID int64, source Source, externalID string) (*Workout, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+selectCols+` FROM workouts
		WHERE user_id = ? AND source = ? AND external_id = ?`, userID, string(source), externalID)
	w, err := scanWorkout(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return w, err
}

func (r *SQLiteRepository) Get(ctx context.Context, userID int64, id string) (*Workout, error) {
	row := r.db.QueryRowContext(ctx, `SELECT `+selectCols+` FROM workouts WHERE id = ? AND user_id = ?`, id, userID)
	w, err := scanWorkout(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return w, err
}

func (r *SQLiteRepository) List(ctx context.Context, userID int64) ([]Workout, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT `+selectCols+` FROM workouts WHERE user_id = ? ORDER BY start_time DESC`, userID)
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
	rows, err := r.db.QueryContext(ctx, `SELECT `+selectSummaryCols+` FROM workouts WHERE user_id = ? ORDER BY start_time DESC`, userID)
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

// SetRawFilename records which file a workout was imported from. It runs after
// the archive is written, so the column is only ever set when a file really is
// on disk — which is what lets the detail response answer "is there an original"
// from the row it already loaded.
//
// Not part of Create: archiving is decided by an admin setting that is read
// after the workout exists, and folding it into the insert would mean threading
// that decision down into the ingest path for one optional column.
func (r *SQLiteRepository) SetRawFilename(ctx context.Context, workoutID, filename string) error {
	if _, err := r.db.ExecContext(ctx,
		`UPDATE workouts SET raw_filename = ? WHERE id = ?`, filename, workoutID); err != nil {
		return fmt.Errorf("set raw filename: %w", err)
	}
	return nil
}

// ImportWindow answers "when did the last n imports from this source happen?"
// by reading the created_at of the newest and of the nth newest.
//
// Both ends, not just the start. A notification is permanent and its link is
// read at some arbitrary later time — by then the folder watch has usually run
// again, and an open-ended window would quietly grow to include those newer
// workouts too. "3 workouts imported" would open on five.
//
// Derived here rather than taken from the client, deliberately. The obvious
// alternative — the importing device reporting when it started — depends on that
// device's clock agreeing with this one, and on every installed version of it
// sending the field at all. Both assumptions fail quietly: a phone a few minutes
// ahead produces a window that matches nothing, and an older build produces no
// window at all. The database already knows, so nobody has to be asked.
//
// Returns zero times when there are fewer than n, which callers treat as "no
// window" rather than as an error.
func (r *SQLiteRepository) ImportWindow(ctx context.Context, userID int64, source Source, n int) (start, end time.Time, err error) {
	if n < 1 {
		return time.Time{}, time.Time{}, nil
	}
	rows, err := r.db.QueryContext(ctx, `SELECT created_at FROM workouts
		WHERE user_id = ? AND source = ?
		ORDER BY created_at DESC LIMIT ?`, userID, string(source), n)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	defer rows.Close()

	var stamps []string
	for rows.Next() {
		var createdAt string
		if err := rows.Scan(&createdAt); err != nil {
			return time.Time{}, time.Time{}, err
		}
		stamps = append(stamps, createdAt)
	}
	if err := rows.Err(); err != nil {
		return time.Time{}, time.Time{}, err
	}
	// Fewer rows than the batch claims means one of them has already been
	// deleted, and the window can no longer be located.
	if len(stamps) < n {
		return time.Time{}, time.Time{}, nil
	}

	end, err = time.Parse(time.RFC3339, stamps[0])
	if err != nil {
		return time.Time{}, time.Time{}, nil
	}
	start, err = time.Parse(time.RFC3339, stamps[len(stamps)-1])
	if err != nil {
		return time.Time{}, time.Time{}, nil
	}
	return start, end, nil
}

// KnownContentHashes returns which of the given content hashes this user has
// already imported.
//
// Imports are content-addressed, so re-uploading a file the user already has
// only resolves to the stored workout — correct, but it still costs a full
// upload and parse per file. Asking about a whole batch of hashes up front
// turns that into one small query, which is what makes re-scanning a folder or
// re-importing an export archive cheap rather than a wholesale re-upload.
//
// Owner-scoped like every other query here: two users with the same file each
// get their own workout, and neither learns anything about the other's library.
func (r *SQLiteRepository) KnownContentHashes(ctx context.Context, userID int64, hashes []string) ([]string, error) {
	if len(hashes) == 0 {
		return []string{}, nil
	}
	// Placeholders are built from the slice length, never from its contents, so
	// the hashes stay bound parameters.
	args := make([]any, 0, len(hashes)+1)
	args = append(args, userID)
	placeholders := make([]string, len(hashes))
	for i, h := range hashes {
		placeholders[i] = "?"
		args = append(args, h)
	}
	query := `SELECT content_hash FROM workouts
		WHERE user_id = ? AND content_hash IN (` + strings.Join(placeholders, ",") + `)`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query known content hashes: %w", err)
	}
	defer rows.Close()
	out := make([]string, 0, len(hashes))
	for rows.Next() {
		var h string
		if err := rows.Scan(&h); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// DeleteAllForUser removes every workout a user owns, returning the ids that
// were deleted so the caller can also drop the archived upload files, which
// live on disk rather than in the database.
//
// The ids are read before the delete rather than derived from it because
// database/sql has no portable "returning" support across SQLite and Postgres.
// Nothing can slip between the two statements in practice: this only runs once
// the account itself is gone, so there is no session left that could create a
// workout for it.
//
// The foreign keys on workout_equipment and workout_shares take their rows with
// them, so this is the only statement needed for the workout side.
func (r *SQLiteRepository) DeleteAllForUser(ctx context.Context, userID int64) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM workouts WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("list workouts for user: %w", err)
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Released before the delete, not just by the deferred call: the pool is
	// capped at one connection, so an open result set would leave the Exec
	// below waiting for a connection that only it can free. Close is
	// idempotent, so the defer above stays as the error-path safety net.
	rows.Close()

	if _, err := r.db.ExecContext(ctx, `DELETE FROM workouts WHERE user_id = ?`, userID); err != nil {
		return nil, fmt.Errorf("delete workouts for user: %w", err)
	}
	return ids, nil
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

// nullIfEmpty stores an empty string as SQL NULL, which is what keeps
// non-de-duplicable rows out of the partial unique index on external_id.
func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// isUniqueViolation reports whether err is a unique-constraint failure. The
// message differs per driver ("UNIQUE constraint failed" on SQLite, "duplicate
// key value violates unique constraint" on Postgres), so both are matched to
// keep the repository portable without importing driver-specific error types.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unique constraint") || strings.Contains(msg, "duplicate key value")
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
		source      string
		visibility  string
		createdAt   string
	)
	if err := row.Scan(&w.ID, &w.UserID, &w.Name, &typ, &startTime, &w.Duration, &w.Distance,
		&w.AvgHR, &w.MaxHR, &w.ElevationGain, &w.Calories, &w.Steps, &w.AvgPace, &w.AvgSpeed,
		&s.route, &s.hr, &s.pace, &s.elev, &s.cadence, &w.Notes,
		&calManual, &calReported, &stepManual, &source, &visibility, &w.RawFilename, &createdAt); err != nil {
		return nil, err
	}
	w.CaloriesManual = calManual != 0
	w.CaloriesReported = calReported != 0
	w.StepsManual = stepManual != 0
	w.Source = Source(source)
	w.Visibility = Visibility(visibility)
	// Best effort: an unparseable timestamp is not a reason to fail a read, and
	// the zero value serialises away.
	if t, err := time.Parse(time.RFC3339, createdAt); err == nil {
		w.CreatedAt = t
	}
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
		source      string
		visibility  string
		createdAt   string
	)
	if err := row.Scan(&w.ID, &w.UserID, &w.Name, &typ, &startTime, &w.Duration, &w.Distance,
		&w.AvgHR, &w.MaxHR, &w.ElevationGain, &w.Calories, &w.Steps, &w.AvgPace, &w.AvgSpeed, &w.Notes,
		&calManual, &calReported, &stepManual, &source, &visibility, &createdAt); err != nil {
		return nil, err
	}
	w.CaloriesManual = calManual != 0
	w.CaloriesReported = calReported != 0
	w.StepsManual = stepManual != 0
	w.Source = Source(source)
	w.Visibility = Visibility(visibility)
	// Best effort: an unparseable timestamp is not a reason to fail a read, and
	// the zero value serialises away.
	if t, err := time.Parse(time.RFC3339, createdAt); err == nil {
		w.CreatedAt = t
	}
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
