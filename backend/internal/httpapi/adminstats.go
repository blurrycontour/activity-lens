package httpapi

import (
	"context"
	"database/sql"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// UserStats is what one account has accumulated on this instance.
type UserStats struct {
	Workouts  int `json:"workouts"`
	Equipment int `json:"equipment"`
	Photos    int `json:"photos"`
	// PhotoBytes and OriginalBytes are what this user costs on disk, kept apart
	// because they are governed by different things: photos exist because
	// someone added them, archived originals because an admin left the setting
	// on. An admin deciding what to reclaim needs to know which is which.
	PhotoBytes    int64 `json:"photoBytes"`
	OriginalBytes int64 `json:"originalBytes"`
	// FirstWorkout and LastWorkout bound the library, RFC 3339, empty when it
	// is empty. "Signed up in March, last workout in April" is the shape of a
	// question an admin actually has.
	FirstWorkout string `json:"firstWorkout,omitempty"`
	LastWorkout  string `json:"lastWorkout,omitempty"`
}

// AdminStatsStore computes per-user totals for the admin screens.
//
// Deliberately one grouped query per metric over the whole table rather than a
// few queries per user: the admin list shows everyone, and the per-user shape
// is what turns a page render into an N+1. Everything here is keyed by user id
// so a caller can look up one or all with the same call.
type AdminStatsStore struct {
	db      *sql.DB
	dataDir string
}

func NewAdminStatsStore(db *sql.DB, dataDir string) *AdminStatsStore {
	return &AdminStatsStore{db: db, dataDir: dataDir}
}

// All returns stats for every user, keyed by id.
func (a *AdminStatsStore) All(ctx context.Context) (map[int64]*UserStats, error) {
	out := map[int64]*UserStats{}
	at := func(id int64) *UserStats {
		if s, ok := out[id]; ok {
			return s
		}
		s := &UserStats{}
		out[id] = s
		return s
	}

	// Workouts, and the span they cover.
	rows, err := a.db.QueryContext(ctx,
		`SELECT user_id, COUNT(*), MIN(start_time), MAX(start_time) FROM workouts GROUP BY user_id`)
	if err != nil {
		return nil, fmt.Errorf("count workouts: %w", err)
	}
	for rows.Next() {
		var id int64
		var n int
		var first, last sql.NullString
		if err := rows.Scan(&id, &n, &first, &last); err != nil {
			rows.Close()
			return nil, err
		}
		s := at(id)
		s.Workouts, s.FirstWorkout, s.LastWorkout = n, first.String, last.String
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if err := a.scanCounts(ctx, out, at,
		`SELECT user_id, COUNT(*), 0 FROM equipment GROUP BY user_id`,
		func(s *UserStats, n int, _ int64) { s.Equipment = n }); err != nil {
		return nil, fmt.Errorf("count equipment: %w", err)
	}

	// Photos are joined back to their workout for the owner, because
	// workout_media is keyed by workout rather than by user.
	if err := a.scanCounts(ctx, out, at,
		`SELECT w.user_id, COUNT(*), COALESCE(SUM(m.bytes), 0)
		   FROM workout_media m JOIN workouts w ON w.id = m.workout_id
		  GROUP BY w.user_id`,
		func(s *UserStats, n int, sum int64) { s.Photos, s.PhotoBytes = n, sum }); err != nil {
		return nil, fmt.Errorf("count photos: %w", err)
	}

	// Archived originals are files whose size is nowhere in the database, so
	// this is the one metric that has to touch the disk. See originalBytes.
	sizes, err := a.originalBytes(ctx)
	if err != nil {
		// A stat failure is not worth failing the whole admin page for: every
		// other number is already computed and correct.
		return out, nil
	}
	for id, n := range sizes {
		at(id).OriginalBytes = n
	}
	return out, nil
}

// scanCounts runs a `user_id, count, sum` query and folds it in.
func (a *AdminStatsStore) scanCounts(
	ctx context.Context,
	out map[int64]*UserStats,
	at func(int64) *UserStats,
	query string,
	set func(*UserStats, int, int64),
) error {
	rows, err := a.db.QueryContext(ctx, query)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var n int
		var sum int64
		if err := rows.Scan(&id, &n, &sum); err != nil {
			return err
		}
		set(at(id), n, sum)
	}
	return rows.Err()
}

// originalBytes totals the archived upload files each user owns.
//
// The size is not in the database — 0018 moved these to disk and kept only the
// filename — so this walks the directory once and attributes each file to a
// user through the workout that names it. One walk and one query for the whole
// instance, rather than a stat per workout.
//
// Files are stored as "<workout id><original extension>.zst", and a workout id
// contains no dot, so the id is everything before the first one. That makes the
// attribution a map lookup rather than a prefix scan of every filename against
// every workout.
func (a *AdminStatsStore) originalBytes(ctx context.Context) (map[int64]int64, error) {
	dir := filepath.Join(a.dataDir, "raw-uploads")
	byWorkout := map[string]int64{}
	err := filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			// A missing directory is the normal case when nobody has ever
			// turned archiving on.
			if os.IsNotExist(err) {
				return fs.SkipAll
			}
			return err
		}
		if d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		id, _, _ := strings.Cut(d.Name(), ".")
		if id != "" {
			byWorkout[id] += info.Size()
		}
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if len(byWorkout) == 0 {
		return map[int64]int64{}, nil
	}

	rows, err := a.db.QueryContext(ctx,
		`SELECT id, user_id FROM workouts WHERE raw_filename != ''`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]int64{}
	for rows.Next() {
		var wid string
		var uid int64
		if err := rows.Scan(&wid, &uid); err != nil {
			return nil, err
		}
		out[uid] += byWorkout[wid]
	}
	return out, rows.Err()
}
