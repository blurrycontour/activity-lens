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
	// ListSharedByMeWithSummary is the mirror: the owner's own workouts that
	// they have shared with one particular person.
	ListSharedByMeWithSummary(ctx context.Context, ownerID, recipientID int64) ([]Workout, error)
	// Gallery photos. Every one of these is scoped by workout id and carries
	// no permission logic of its own — the caller establishes that the user may
	// see (to read) or owns (to write) the workout first, exactly as the
	// handlers for shares do.
	ListMedia(ctx context.Context, workoutID string) ([]Media, error)
	GetMedia(ctx context.Context, workoutID, mediaID string) (Media, error)
	CountMedia(ctx context.Context, workoutID string) (int, error)
	AddMedia(ctx context.Context, m Media) error
	DeleteMedia(ctx context.Context, workoutID, mediaID string) error
	// DeleteMediaForUser removes every photo a user added, wherever it lives.
	// Rows on their own workouts go with the workout through the foreign key;
	// this is for photos they added to somebody else's, which have no key back
	// to the account. Nothing creates those yet — the upload path is
	// owner-only — but the column exists so that it can, and an account
	// deletion that leaves someone's photos behind is exactly the bug this
	// would be.
	DeleteMediaForUser(ctx context.Context, userID int64) error

	// Comments and reactions. Same contract as the gallery: scoped by workout
	// id, no permission logic of their own. The caller has established both
	// that the user may see the workout and that it is shared — see social.go.
	ListComments(ctx context.Context, subj Subject) ([]Comment, error)
	GetComment(ctx context.Context, subj Subject, commentID string) (Comment, error)
	AddComment(ctx context.Context, subj Subject, c Comment) error
	// UpdateComment only matches a comment authorID wrote; anyone else's is
	// ErrCommentNotFound, which is also what a missing id returns.
	UpdateComment(ctx context.Context, subj Subject, commentID string, authorID int64, body string) (Comment, error)
	// DeleteComment is author-scoped unless allowAny, which the workout's
	// owner gets so they can moderate their own page.
	DeleteComment(ctx context.Context, subj Subject, commentID string, requesterID int64, allowAny bool) error
	// DeleteCommentsForUser removes every comment an account wrote, including
	// the ones on other people's workouts, which have no key back to it.
	DeleteCommentsForUser(ctx context.Context, userID int64) error

	ListReactions(ctx context.Context, subj Subject) ([]Reaction, error)
	// SetReaction replaces whatever the user had; one each is a property of
	// the primary key, not of the caller.
	SetReaction(ctx context.Context, subj Subject, userID int64, emoji string) error
	ClearReaction(ctx context.Context, subj Subject, userID int64) error
	DeleteReactionsForUser(ctx context.Context, userID int64) error

	// IsShared reports whether a workout the owner holds is visible to anyone
	// else — public, or shared with at least one person. It is the gate the
	// whole Social tab hangs on.
	IsShared(ctx context.Context, ownerID int64, workoutID string) (bool, error)

	// SetVisibility flips a workout the caller owns; ErrNotFound otherwise.
	SetVisibility(ctx context.Context, ownerID int64, id string, v Visibility) error
	// ShareRecipients lists the user ids a workout the caller owns is shared
	// with, oldest share first.
	ShareRecipients(ctx context.Context, ownerID int64, workoutID string) ([]int64, error)
	// ShareCounts maps workout id to recipient count across everything ownerID
	// owns, in one query, so listing a library never fans out per row.
	ShareCounts(ctx context.Context, ownerID int64) (map[string]int, error)
	ShareRecipientsByWorkout(ctx context.Context, ownerID int64) (map[string][]int64, error)
	FlagsFor(ctx context.Context, ids []string) (map[string]RowFlags, error)
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

	// ListPendingWeather returns up to limit workouts belonging to userIDs that
	// still owe a weather lookup, newest first — so someone who has just
	// imported sees this week fill in before a five-year-old backfill finishes.
	//
	// Takes an explicit id set rather than being owner-scoped because only the
	// background pass calls it, and only for users who have the setting on. Same
	// shape of exception as SetRawFilename.
	//
	// The caller MUST let this return before doing any network work. It
	// materialises its rows for exactly that reason: see the note on the
	// implementation.
	ListPendingWeather(ctx context.Context, userIDs []int64, maxAttempts, limit int) ([]WeatherTarget, error)
	// ResolveWeatherStart fills in the start coordinate of a workout that
	// predates this feature, reading it out of the route blob. Returns
	// ok=false, having settled the row to skipped, when there is no usable one.
	ResolveWeatherStart(ctx context.Context, workoutID string) (lat, lon float64, ok bool, err error)
	// SetWeather records a reading and the status that vouches for it —
	// WeatherOK from a lookup, WeatherManual from a person.
	SetWeather(ctx context.Context, workoutID string, status WeatherStatus, w Weather) error
	// MarkWeatherSkipped records that this workout can never have weather.
	MarkWeatherSkipped(ctx context.Context, workoutID string) error
	// MarkWeatherFailed increments the attempt counter, leaving the row
	// retryable until the caller's cap is reached.
	MarkWeatherFailed(ctx context.Context, workoutID string) error
	// RequestWeatherBackfill queues every workout of this user's that was never
	// asked about, and returns how many. This is the only thing that moves rows
	// out of WeatherNone in bulk, which is what keeps "turn the setting on" from
	// silently meaning "send my whole location history somewhere".
	RequestWeatherBackfill(ctx context.Context, userID int64) (int, error)
	// RetryFailedWeather re-queues this user's exhausted lookups, clearing the
	// attempt counter. The only way out of WeatherFailed short of typing the
	// conditions in by hand.
	RetryFailedWeather(ctx context.Context, userID int64) (int, error)
	// WeatherCounts tallies this user's workouts by status, so the UI can offer
	// each action with a number rather than a vague promise.
	WeatherCounts(ctx context.Context, userID int64) (WeatherCounts, error)

	// ListTracks returns simplified routes for the overview map, filtered by
	// viewport and date range in SQL so a pan never decompresses a library.
	ListTracks(ctx context.Context, userID int64, q TrackQuery) ([]Track, error)
	// ListMissingTracks returns workouts that predate this feature, with their
	// routes, for the background pass to simplify. Same materialise-before-you-
	// write rule as ListPendingWeather.
	ListMissingTracks(ctx context.Context, limit int) ([]TrackBackfill, error)
	// SetTrack stores a simplified route and its bounding box.
	SetTrack(ctx context.Context, workoutID string, route []LatLng) error
	// CountMissingTracks reports how much of the backfill is left.
	CountMissingTracks(ctx context.Context, userID int64) (int, error)
	// CountCadence settles the cadence sample count for rows that predate the
	// column, in batches, and reports how many it did.
	CountCadence(ctx context.Context, limit int) (int, error)
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
//
// weatherCols is appended to both sets, and appended is the operative word: the
// two scanners below take positional arguments, so anything inserted in the
// middle silently shifts every field after it. New columns go on the end.
//
// It is in the *summary* set deliberately. That is what lets the Analysis page
// correlate temperature against pace from the list it already loads, with no
// second endpoint and no per-workout request. Seven scalars against a row that
// already carries twenty is nothing, and the summary scanner does not touch the
// route blob either way. start_lat/start_lon are deliberately absent: only the
// background pass reads those, through its own narrow query.
const weatherCols = `weather_status, weather_temp_c, weather_apparent_c,
	weather_humidity, weather_wind_kph, weather_precip_mm, weather_code`

// Appended after weatherCols, under the same rule: the scanners are positional,
// so a new column goes on the end or it shifts every field after it.
//
// The summary set takes moving_time but not the pauses blob. The list ranks and
// filters on the averages, which are already computed from moving time; the
// intervals themselves are only ever drawn on one workout's charts, and a blob
// per row is exactly what the summary set exists to avoid.
const (
	selectCols = workoutCols + `, visibility, raw_filename, created_at, ` + weatherCols + `, moving_time, pauses`
	// track_points last, and only on the summary set: the detail response
	// carries the route itself, so only a list has to be told whether there is
	// one. Appended, like every column added since — the scanners read by
	// position, and inserting anywhere else moves every field after it.
	selectSummaryCols = workoutSummaryCols + `, visibility, created_at, ` + weatherCols + `, moving_time, track_points, cadence_points`
)

func (r *SQLiteRepository) Create(ctx context.Context, w *Workout) error {
	s, err := marshalSeries(w)
	if err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339)
	// The weather columns are written here and nowhere else in this statement's
	// vicinity: Update deliberately never mentions them, so no edit or
	// recalculation can wipe a reading. See SetWeather and friends below.
	lat, lon, weatherStatus := deriveWeatherTarget(w)
	// The simplified track for the overview map, derived here for the same
	// reason: the route is in memory at exactly this moment and nowhere else
	// without decompressing it again.
	track, box, err := trackFor(w.Route)
	if err != nil {
		return err
	}
	pauses, err := marshalPauses(w.Pauses)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO workouts (`+insertCols+`, created_at, updated_at,
		start_lat, start_lon, weather_status,
		track, track_points, bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon,
		cadence_points, moving_time, pauses)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		w.ID, w.UserID, w.Name, string(w.Type), w.StartTime.UTC().Format(time.RFC3339),
		w.Duration, w.Distance, w.AvgHR, w.MaxHR, w.ElevationGain, w.Calories, w.Steps,
		w.AvgPace, w.AvgSpeed, s.route, s.hr, s.pace, s.elev, s.cadence, w.Notes,
		boolToInt(w.CaloriesManual), boolToInt(w.CaloriesReported), boolToInt(w.StepsManual),
		string(w.Source), nullIfEmpty(w.ExternalID), nullIfEmpty(w.ContentHash), now, now,
		lat, lon, string(weatherStatus),
		track.blob, track.points, box.MinLat, box.MaxLat, box.MinLon, box.MaxLon,
		len(w.CadenceTimeline),
		w.MovingTime, pauses)
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
	pauses, err := marshalPauses(w.Pauses)
	if err != nil {
		return err
	}
	res, err := r.db.ExecContext(ctx, `UPDATE workouts SET name=?, type=?, start_time=?, duration=?,
		distance=?, avg_hr=?, max_hr=?, elevation_gain=?, calories=?, steps=?, avg_pace=?, avg_speed=?,
		route=?, hr_timeline=?, pace_timeline=?, elev_timeline=?, cadence_timeline=?, notes=?,
		calories_manual=?, calories_reported=?, steps_manual=?, moving_time=?, pauses=?,
		cadence_points=?, updated_at=?
		WHERE id=? AND user_id=?`,
		w.Name, string(w.Type), w.StartTime.UTC().Format(time.RFC3339), w.Duration, w.Distance,
		w.AvgHR, w.MaxHR, w.ElevationGain, w.Calories, w.Steps, w.AvgPace, w.AvgSpeed,
		s.route, s.hr, s.pace, s.elev, s.cadence, w.Notes,
		boolToInt(w.CaloriesManual), boolToInt(w.CaloriesReported), boolToInt(w.StepsManual),
		// Derived, so unlike the weather columns these are refreshed here: a
		// Recalculate is how a workout imported before pauses existed gets them.
		w.MovingTime, pauses,
		// Recounted here, so dropping the series in a reshape is visible to the
		// list filter immediately rather than at the next backfill.
		len(w.CadenceTimeline),
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

// ListPendingWeather returns the next batch of workouts owed a weather lookup.
//
// Every row is read into the slice before this returns, and that is not an
// implementation detail — it is load-bearing. The pool is capped at one
// connection (store/db.go), so a caller that iterated *sql.Rows while making
// HTTP calls and then issued an UPDATE would deadlock: the UPDATE waits for the
// connection the open cursor is holding, and nothing ever releases it. That
// takes down every HTTP handler in the process, not just this pass. Draining
// first makes the deadlock structurally impossible rather than a rule someone
// has to remember.
func (r *SQLiteRepository) ListPendingWeather(ctx context.Context, userIDs []int64, maxAttempts, limit int) ([]WeatherTarget, error) {
	if len(userIDs) == 0 || limit <= 0 {
		return nil, nil
	}
	// Placeholders from the slice length, never its contents.
	args := make([]any, 0, len(userIDs)+2)
	placeholders := make([]string, len(userIDs))
	for i, id := range userIDs {
		placeholders[i] = "?"
		args = append(args, id)
	}
	args = append(args, maxAttempts, limit)
	query := `SELECT id, start_time, duration, start_lat, start_lon FROM workouts
		WHERE user_id IN (` + strings.Join(placeholders, ",") + `)
		  AND weather_status IN ('pending','failed')
		  AND weather_attempts < ?
		ORDER BY start_time DESC
		LIMIT ?`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query pending weather: %w", err)
	}
	defer rows.Close()
	var out []WeatherTarget
	for rows.Next() {
		var (
			t         WeatherTarget
			startTime string
		)
		if err := rows.Scan(&t.ID, &startTime, &t.Duration, &t.Lat, &t.Lon); err != nil {
			return nil, err
		}
		// An unparseable start time cannot be looked up and will never become
		// parseable, so it is simply not returned; the row stays pending and
		// costs one skipped scan per pass rather than a doomed request.
		if parsed, err := time.Parse(time.RFC3339, startTime); err == nil {
			t.StartTime = parsed
			out = append(out, t)
		}
	}
	return out, rows.Err()
}

// SetWeather records a reading. Not owner-scoped: the background pass has
// already established ownership by selecting the batch per user, and a manual
// edit goes through the service, which checks.
func (r *SQLiteRepository) SetWeather(ctx context.Context, workoutID string, status WeatherStatus, w Weather) error {
	_, err := r.db.ExecContext(ctx, `UPDATE workouts SET
		weather_status = ?, weather_temp_c = ?, weather_apparent_c = ?, weather_humidity = ?,
		weather_wind_kph = ?, weather_precip_mm = ?, weather_code = ?, weather_attempts = 0
		WHERE id = ?`,
		string(status), w.TempC, w.ApparentC, w.Humidity, w.WindKph, w.PrecipMm, w.Code, workoutID)
	if err != nil {
		return fmt.Errorf("set weather: %w", err)
	}
	return nil
}

// MarkWeatherSkipped records that this workout can never have weather.
func (r *SQLiteRepository) MarkWeatherSkipped(ctx context.Context, workoutID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE workouts SET weather_status = ? WHERE id = ?`, string(WeatherSkipped), workoutID)
	if err != nil {
		return fmt.Errorf("mark weather skipped: %w", err)
	}
	return nil
}

// MarkWeatherFailed counts one failed attempt. The row stays selectable until
// the caller's cap is reached, at which point the WHERE clause in
// ListPendingWeather stops returning it and it rests as 'failed' — which the UI
// reads as "we tried and could not", distinct from "we have not looked".
//
// A manual entry is never demoted: someone who typed a temperature in should
// not have that undone by a lookup that happened to be in flight.
func (r *SQLiteRepository) MarkWeatherFailed(ctx context.Context, workoutID string) error {
	_, err := r.db.ExecContext(ctx,
		`UPDATE workouts SET weather_status = ?, weather_attempts = weather_attempts + 1
		 WHERE id = ? AND weather_status != ?`,
		string(WeatherFailed), workoutID, string(WeatherManual))
	if err != nil {
		return fmt.Errorf("mark weather failed: %w", err)
	}
	return nil
}

// ResolveWeatherStart fills in a workout's start coordinate from its route.
//
// Only workouts that predate this feature need this. Everything inserted since
// had its coordinate written at insert, which is the whole point of the
// denormalisation — but the migration could not do the same for existing rows,
// because the coordinate lives inside a gzipped JSON blob that SQL cannot read.
//
// So the cost is paid here instead: once per legacy workout, inside the paced
// background pass, rather than in one enormous pass at the moment somebody
// clicks a button. Returns ok=false when there is no usable point, and settles
// the row to 'skipped' so it is never decompressed again.
func (r *SQLiteRepository) ResolveWeatherStart(ctx context.Context, workoutID string) (lat, lon float64, ok bool, err error) {
	var blob []byte
	if err := r.db.QueryRowContext(ctx,
		`SELECT route FROM workouts WHERE id = ?`, workoutID).Scan(&blob); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, 0, false, ErrNotFound
		}
		return 0, 0, false, fmt.Errorf("read route: %w", err)
	}
	var route []LatLng
	if err := unmarshalInto(blob, &route); err != nil {
		return 0, 0, false, err
	}
	// Reuse the same judgement the insert path applies, so a legacy row and a
	// new one can never disagree about what counts as a usable location.
	probe := &Workout{Route: route, StartTime: time.Now()}
	lat, lon, status := deriveWeatherTarget(probe)
	if status != WeatherPending {
		if err := r.MarkWeatherSkipped(ctx, workoutID); err != nil {
			return 0, 0, false, err
		}
		return 0, 0, false, nil
	}
	if _, err := r.db.ExecContext(ctx,
		`UPDATE workouts SET start_lat = ?, start_lon = ? WHERE id = ?`, lat, lon, workoutID); err != nil {
		return 0, 0, false, fmt.Errorf("store start coordinate: %w", err)
	}
	return lat, lon, true, nil
}

// RequestWeatherBackfill queues this user's never-asked-about workouts.
//
// Status only — it does not try to work out which of them have a location,
// because for rows that predate this feature that answer is inside a compressed
// blob and finding it for a whole library in one request is exactly the kind of
// work that times out. The background pass resolves each one as it reaches it,
// via ResolveWeatherStart, and settles the ones that turn out to have no route.
//
// This is the only thing that moves rows out of WeatherNone in bulk, and it is
// only ever called from an explicit user action. That is what keeps "turn the
// setting on" from quietly meaning "send my entire location history somewhere".
func (r *SQLiteRepository) RequestWeatherBackfill(ctx context.Context, userID int64) (int, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE workouts SET weather_status = ?, weather_attempts = 0
		 WHERE user_id = ? AND weather_status = ?`,
		string(WeatherPending), userID, string(WeatherNone))
	if err != nil {
		return 0, fmt.Errorf("request weather backfill: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, nil
	}
	return int(n), nil
}

// RetryFailedWeather puts this user's failed lookups back in the queue.
//
// Failures are bounded by an attempt counter so that a workout the service
// genuinely cannot answer for does not retry forever — but that cap is reached
// by transient outages too, and once reached there was previously no way back
// short of typing the conditions in by hand. This is that way back: it clears
// the counter rather than raising the cap, so the same five-attempt budget
// applies to the retry.
//
// Deliberately an explicit action. Retrying automatically would mean an
// unreachable service is re-attempted every pass forever, which is precisely
// what the cap exists to prevent.
func (r *SQLiteRepository) RetryFailedWeather(ctx context.Context, userID int64) (int, error) {
	res, err := r.db.ExecContext(ctx,
		`UPDATE workouts SET weather_status = ?, weather_attempts = 0
		 WHERE user_id = ? AND weather_status = ?`,
		string(WeatherPending), userID, string(WeatherFailed))
	if err != nil {
		return 0, fmt.Errorf("retry failed weather: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, nil
	}
	return int(n), nil
}

// WeatherCounts tallies a user's workouts by weather status.
//
// One grouped query rather than a count per state: the settings page shows all
// of them at once, and five round trips to render one card is the sort of thing
// that is fine at ten workouts and not at ten thousand.
//
// The unchecked figure is deliberately an over-count — some of those rows will
// turn out to have no route and be skipped. Establishing which would mean
// decompressing the library to render a settings page, and "we will check 300
// workouts" is an honest description of what the backfill does, where "300
// workouts will get weather" would not be.
func (r *SQLiteRepository) WeatherCounts(ctx context.Context, userID int64) (WeatherCounts, error) {
	var out WeatherCounts
	rows, err := r.db.QueryContext(ctx,
		`SELECT weather_status, COUNT(*) FROM workouts WHERE user_id = ? GROUP BY weather_status`,
		userID)
	if err != nil {
		return out, fmt.Errorf("count weather: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			return WeatherCounts{}, fmt.Errorf("scan weather count: %w", err)
		}
		switch WeatherStatus(status) {
		case WeatherOK:
			out.Recorded += n
		case WeatherManual:
			out.Recorded += n
			out.Manual = n
		case WeatherPending:
			out.Scheduled = n
		case WeatherFailed:
			out.Failed = n
		case WeatherSkipped:
			out.Skipped = n
		case WeatherNone:
			out.Unchecked = n
		}
	}
	if err := rows.Err(); err != nil {
		return WeatherCounts{}, fmt.Errorf("count weather: %w", err)
	}
	return out, nil
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

// marshalPauses encodes the pause list the same way the timelines are encoded,
// so one decoder reads all of them. Nil becomes an empty list rather than a
// NULL: a NULL blob and an empty one both mean "no pauses", and having only one
// representation is one fewer thing for a reader to handle.
func marshalPauses(pauses []Pause) ([]byte, error) {
	if pauses == nil {
		pauses = []Pause{}
	}
	data, err := json.Marshal(pauses)
	if err != nil {
		return nil, fmt.Errorf("marshal pauses: %w", err)
	}
	return gzipBytes(data)
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// weatherScan holds the weather columns between the row and the model.
//
// Shared by both scanners rather than repeated, because they drift: they take
// positional arguments and there is nothing but care keeping their two
// argument lists in step with one column set. One struct and one applyTo means
// a mistake is a compile error in one place instead of a silent field shift in
// one of two.
type weatherScan struct {
	status                                 string
	temp, apparent, humidity, wind, precip float64
	code                                   int
}

// applyTo attaches the reading to a workout, or does not.
//
// The gate: every weather column is NOT NULL DEFAULT 0, so a workout that was
// never looked up scans as a perfectly plausible 0 °C, 0 % humidity, clear sky.
// Only the status distinguishes that from a real winter morning, and this is
// the single place that decision is made — a nil Weather is the model's way of
// saying "we do not know", and no caller can accidentally read a default as a
// measurement.
func (wx weatherScan) applyTo(w *Workout) {
	w.WeatherStatus = WeatherStatus(wx.status)
	if !w.WeatherStatus.HasReading() {
		return
	}
	w.Weather = &Weather{
		TempC:     wx.temp,
		ApparentC: wx.apparent,
		Humidity:  wx.humidity,
		WindKph:   wx.wind,
		PrecipMm:  wx.precip,
		Code:      wx.code,
	}
}

// deriveWeatherTarget decides where a workout happened and whether a weather
// lookup is worth queueing for it.
//
// Pure, and called from Create rather than from the service, so every insert
// path is covered — upload, bulk import, auto-import, manual entry — without
// each one having to remember. Deriving it in the service instead would mean
// carrying two write-only coordinate fields on the Workout model just to hand
// them down one layer.
//
// WeatherSkipped is permanent and is the honest answer for most of these: a
// treadmill session is never going to acquire a location. Returning
// WeatherPending for them instead would mean the background pass retried every
// strength workout in the library forever, which in most libraries is most of
// the rows.
func deriveWeatherTarget(w *Workout) (lat, lon float64, status WeatherStatus) {
	if len(w.Route) == 0 {
		return 0, 0, WeatherSkipped
	}
	// Indoor by definition. A treadmill run carrying a stray GPS fix is
	// indistinguishable from an outdoor one in this data, so this catches only
	// the case the type already tells us about.
	if w.Type == TypeStrength {
		return 0, 0, WeatherSkipped
	}
	// No archive has tomorrow's weather. A clock-skewed device would otherwise
	// burn its five attempts against a permanent error.
	if w.StartTime.After(time.Now().Add(24 * time.Hour)) {
		return 0, 0, WeatherSkipped
	}
	lat, lon = w.Route[0][0], w.Route[0][1]
	if lat < -90 || lat > 90 || lon < -180 || lon > 180 {
		return 0, 0, WeatherSkipped
	}
	// Null Island: what a GPS writes when it has no fix at all. A real workout
	// there is possible and this rejects it, which is the right trade against
	// storing tropical-Atlantic weather for someone's local park run.
	if lat == 0 && lon == 0 {
		return 0, 0, WeatherSkipped
	}
	return lat, lon, WeatherPending
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
		wx          weatherScan
		pauses      []byte
	)
	if err := row.Scan(&w.ID, &w.UserID, &w.Name, &typ, &startTime, &w.Duration, &w.Distance,
		&w.AvgHR, &w.MaxHR, &w.ElevationGain, &w.Calories, &w.Steps, &w.AvgPace, &w.AvgSpeed,
		&s.route, &s.hr, &s.pace, &s.elev, &s.cadence, &w.Notes,
		&calManual, &calReported, &stepManual, &source, &visibility, &w.RawFilename, &createdAt,
		&wx.status, &wx.temp, &wx.apparent, &wx.humidity, &wx.wind, &wx.precip, &wx.code,
		&w.MovingTime, &pauses); err != nil {
		return nil, err
	}
	if err := unmarshalInto(pauses, &w.Pauses); err != nil {
		return nil, err
	}
	wx.applyTo(&w)
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
		wx          weatherScan
		trackPoints int
		// -1 until the backfill has decompressed the series and counted it; see
		// the migration. Negative reads as "no cadence" here, which is the safe
		// way round for a filter — it can only omit a row that has some, never
		// claim one that has none.
		cadencePoints int
	)
	if err := row.Scan(&w.ID, &w.UserID, &w.Name, &typ, &startTime, &w.Duration, &w.Distance,
		&w.AvgHR, &w.MaxHR, &w.ElevationGain, &w.Calories, &w.Steps, &w.AvgPace, &w.AvgSpeed, &w.Notes,
		&calManual, &calReported, &stepManual, &source, &visibility, &createdAt,
		&wx.status, &wx.temp, &wx.apparent, &wx.humidity, &wx.wind, &wx.precip, &wx.code,
		&w.MovingTime, &trackPoints, &cadencePoints); err != nil {
		return nil, err
	}
	// A row whose simplified track has not been built yet reads as "no route",
	// which is what the scheduler's track pass is draining. It self-corrects
	// within a few minutes of an upgrade; a filter briefly missing an old
	// workout beats decompressing every route blob to answer a list.
	w.HasRoute = trackPoints > 0
	w.HasCadence = cadencePoints > 0
	wx.applyTo(&w)
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

// ── The overview map ────────────────────────────────────────────────────────

// trackBlob is a simplified route ready for the database, with the point count
// that says whether there is one at all.
type trackBlob struct {
	blob   []byte
	points int
}

// marshalTrack simplifies a route and encodes it the same way the full one is.
//
// The point count is stored beside the blob and is the only thing that
// distinguishes "not computed yet" from "computed, and there was no route" —
// both of which leave a zero bounding box, which is itself a real place in the
// Gulf of Guinea.
func marshalTrack(route []LatLng) (trackBlob, error) {
	if !RouteBounds(route).Ok() {
		// Indoor, or no GPS. Recorded as a settled zero rather than left null,
		// so the backfill does not pick it up again on every pass.
		return trackBlob{points: 0}, nil
	}
	simplified := SimplifyRoute(route)
	data, err := json.Marshal(simplified)
	if err != nil {
		return trackBlob{}, fmt.Errorf("marshal track: %w", err)
	}
	blob, err := gzipBytes(data)
	if err != nil {
		return trackBlob{}, err
	}
	return trackBlob{blob: blob, points: len(simplified)}, nil
}

// noRouteBounds marks a workout as looked-at and mapless.
//
// Out of range for a real coordinate, so it can never match a viewport, and
// non-zero, so the backfill can tell it apart from a row that has never been
// computed. Those two are the same value otherwise — the migration defaults
// every box to zero, and zero is also a real place in the Gulf of Guinea.
//
// A nullable column would say this more plainly, but every other column here is
// NOT NULL DEFAULT and mixing the two conventions is worse than one sentinel
// named in one place.
var noRouteBounds = Bounds{MinLat: -999, MaxLat: -999, MinLon: -999, MaxLon: -999}

// trackFor prepares a route for storage: the simplified blob, and a box that
// distinguishes "no route" from "not computed yet" whichever path wrote it.
func trackFor(route []LatLng) (trackBlob, Bounds, error) {
	track, err := marshalTrack(route)
	if err != nil {
		return trackBlob{}, Bounds{}, err
	}
	box := RouteBounds(route)
	if !box.Ok() {
		box = noRouteBounds
	}
	return track, box, nil
}

// Track is one workout as the overview map draws it.
type Track struct {
	ID     string    `json:"id"`
	Name   string    `json:"name"`
	Type   Type      `json:"type"`
	Date   string    `json:"date"`
	Points []LatLng  `json:"points"`
	Meters float64   `json:"meters"`
	Start  time.Time `json:"-"`
}

// TrackQuery bounds what the map asks for.
type TrackQuery struct {
	// Box is the visible area. Zero bounds mean "wherever they are", which is
	// what the first load asks before it knows where to look.
	Box Bounds
	// From and To bound start_time; zero means unbounded.
	From, To time.Time
	// Limit caps the answer. The map draws what it is given and says when it
	// was capped — an unbounded query is the one thing that cannot be made to
	// stay fast as a library grows.
	Limit int
}

// ListTracks returns the simplified routes the map should draw.
//
// Never touches the full route blob: that is the whole point of storing a
// simplified copy. The rows it reads are the small ones, and the bounding-box
// test happens in SQL so a pan over a city does not decompress a library.
func (r *SQLiteRepository) ListTracks(ctx context.Context, userID int64, q TrackQuery) ([]Track, error) {
	where := []string{"user_id = ?", "track_points > 0"}
	args := []any{userID}
	if !q.From.IsZero() {
		where = append(where, "start_time >= ?")
		args = append(args, q.From.UTC().Format(time.RFC3339))
	}
	if !q.To.IsZero() {
		where = append(where, "start_time <= ?")
		args = append(args, q.To.UTC().Format(time.RFC3339))
	}
	if q.Box.Ok() {
		// Rectangle overlap, not containment: a route running off the side of
		// the screen is still on the screen, and testing containment would make
		// long rides vanish as you zoom in on them.
		where = append(where,
			"bbox_min_lat <= ? AND bbox_max_lat >= ? AND bbox_min_lon <= ? AND bbox_max_lon >= ?")
		args = append(args, q.Box.MaxLat, q.Box.MinLat, q.Box.MaxLon, q.Box.MinLon)
	}
	limit := q.Limit
	if limit <= 0 {
		limit = 2000
	}
	args = append(args, limit)

	rows, err := r.db.QueryContext(ctx,
		`SELECT id, name, type, start_time, distance, track FROM workouts
		 WHERE `+strings.Join(where, " AND ")+`
		 ORDER BY start_time DESC LIMIT ?`, args...)
	if err != nil {
		return nil, fmt.Errorf("list tracks: %w", err)
	}
	defer rows.Close()

	out := make([]Track, 0, 64)
	for rows.Next() {
		var t Track
		var startTime string
		var blob []byte
		if err := rows.Scan(&t.ID, &t.Name, &t.Type, &startTime, &t.Meters, &blob); err != nil {
			return nil, fmt.Errorf("scan track: %w", err)
		}
		if err := unmarshalInto(blob, &t.Points); err != nil {
			// One unreadable blob is not a reason to return no map.
			continue
		}
		if len(t.Points) < 2 {
			continue
		}
		if ts, err := time.Parse(time.RFC3339, startTime); err == nil {
			t.Start = ts
			t.Date = ts.Format("2006-01-02")
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// TrackBackfill is a workout still owed a simplified route.
type TrackBackfill struct {
	ID    string
	Route []LatLng
}

// ListMissingTracks returns workouts that predate this feature, with their full
// routes decompressed ready to simplify.
//
// Bounded by limit and materialised before returning, for the same reason
// ListPendingWeather is: the pool holds one connection, so an open cursor plus
// the UPDATE that follows is a deadlock that takes the process with it.
func (r *SQLiteRepository) ListMissingTracks(ctx context.Context, limit int) ([]TrackBackfill, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, route FROM workouts WHERE track_points = 0 AND bbox_min_lat = 0 AND bbox_max_lat = 0
		 LIMIT ?`, limit)
	if err != nil {
		return nil, fmt.Errorf("list missing tracks: %w", err)
	}
	defer rows.Close()

	out := make([]TrackBackfill, 0, limit)
	for rows.Next() {
		var item TrackBackfill
		var blob []byte
		if err := rows.Scan(&item.ID, &blob); err != nil {
			return nil, fmt.Errorf("scan missing track: %w", err)
		}
		// An unreadable route still gets returned, with no points: SetTrack
		// then settles it to a computed zero so it leaves the queue rather than
		// being retried on every pass forever.
		_ = unmarshalInto(blob, &item.Route)
		out = append(out, item)
	}
	return out, rows.Err()
}

// SetTrack stores a simplified route and its bounding box. A workout with no
// usable route is settled rather than left queued; see trackFor.
func (r *SQLiteRepository) SetTrack(ctx context.Context, workoutID string, route []LatLng) error {
	track, box, err := trackFor(route)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx,
		`UPDATE workouts SET track = ?, track_points = ?,
		 bbox_min_lat = ?, bbox_max_lat = ?, bbox_min_lon = ?, bbox_max_lon = ?
		 WHERE id = ?`,
		track.blob, track.points, box.MinLat, box.MaxLat, box.MinLon, box.MaxLon, workoutID)
	if err != nil {
		return fmt.Errorf("set track: %w", err)
	}
	return nil
}

// CountMissingTracks reports how much of the backfill is left, so the map can
// say "still preparing" rather than quietly showing half a library.
func (r *SQLiteRepository) CountMissingTracks(ctx context.Context, userID int64) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM workouts
		 WHERE user_id = ? AND track_points = 0 AND bbox_min_lat = 0 AND bbox_max_lat = 0`,
		userID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count missing tracks: %w", err)
	}
	return n, nil
}

// CountCadence fills in the cadence sample count for rows that predate the
// column, and reports how many it settled.
//
// One statement per batch, and the counting happens here rather than in SQL
// because the series is gzipped JSON: only Go can tell an empty one from a
// full one. Rows that fail to decompress are settled at zero rather than left
// pending, or the pass would pick the same ones up forever and never reach the
// rest — the same rule the track backfill follows.
func (r *SQLiteRepository) CountCadence(ctx context.Context, limit int) (int, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT id, cadence_timeline FROM workouts WHERE cadence_points < 0 LIMIT ?`, limit)
	if err != nil {
		return 0, fmt.Errorf("list uncounted cadence: %w", err)
	}
	counts := make(map[string]int)
	for rows.Next() {
		var (
			id   string
			blob []byte
		)
		if err := rows.Scan(&id, &blob); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan cadence: %w", err)
		}
		var series []CadencePoint
		_ = unmarshalInto(blob, &series)
		counts[id] = len(series)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	// Materialised before writing: the rows above hold the only connection when
	// the pool is small, and an UPDATE inside the loop would wait on it forever.
	for id, n := range counts {
		if _, err := r.db.ExecContext(ctx,
			`UPDATE workouts SET cadence_points = ? WHERE id = ?`, n, id); err != nil {
			return 0, fmt.Errorf("set cadence points: %w", err)
		}
	}
	return len(counts), nil
}
