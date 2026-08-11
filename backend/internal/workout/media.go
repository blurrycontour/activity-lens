package workout

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// Media is one photo attached to a workout.
//
// The bytes are not in here and never travel through JSON: the list is what the
// gallery needs to lay itself out, and each image is fetched separately so the
// browser can cache, lazy-load and decode them on its own schedule. Sending a
// dozen base64 photos inside the workout response would undo all three.
type Media struct {
	ID        string    `json:"id"`
	WorkoutID string    `json:"-"`
	UserID    int64     `json:"-"`
	Kind      string    `json:"kind"`
	Filename  string    `json:"filename,omitempty"`
	MIME      string    `json:"mime"`
	Width     int       `json:"width"`
	Height    int       `json:"height"`
	Bytes     int64     `json:"bytes"`
	Caption   string    `json:"caption,omitempty"`
	Position  int       `json:"position"`
	CreatedAt time.Time `json:"createdAt"`
}

// ErrMediaNotFound is returned when a photo id names nothing on this workout.
var ErrMediaNotFound = errors.New("media not found")

// MaxMediaPerWorkout caps one workout's gallery.
//
// A limit rather than none, because there is no quota anywhere else in the app
// and a self-hosted disk is a finite thing somebody has to notice filling. High
// enough that nobody hits it by accident.
const MaxMediaPerWorkout = 30

// newMediaID returns a random, unguessable id.
//
// Random and not sequential: the id is in the URL of a photo that a shared
// workout serves to other people, and a sequential one would let anyone with a
// single link enumerate the neighbours. The permission check does the real
// work — this only removes the invitation.
func newMediaID() (string, error) {
	var b [12]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("generate media id: %w", err)
	}
	return "m_" + hex.EncodeToString(b[:]), nil
}

// ── Database ──────────────────────────────────────────────────────────────

const mediaCols = `id, workout_id, user_id, kind, filename, mime, width, height, bytes, caption, position, created_at`

// ListMedia returns a workout's photos in display order.
//
// No permission check: the caller has already established that this user may
// see the workout, and doing it again here would mean either a second query or
// a second copy of the visibility rules. See handleListMedia.
func (r *SQLiteRepository) ListMedia(ctx context.Context, workoutID string) ([]Media, error) {
	rows, err := r.db.QueryContext(ctx,
		`SELECT `+mediaCols+` FROM workout_media WHERE workout_id = ? ORDER BY position, created_at, id`,
		workoutID)
	if err != nil {
		return nil, fmt.Errorf("list media: %w", err)
	}
	defer rows.Close()

	var out []Media
	for rows.Next() {
		m, err := scanMedia(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// GetMedia returns one photo's row, scoped to its workout so a valid id for one
// workout cannot be read through another's URL.
func (r *SQLiteRepository) GetMedia(ctx context.Context, workoutID, mediaID string) (Media, error) {
	row := r.db.QueryRowContext(ctx,
		`SELECT `+mediaCols+` FROM workout_media WHERE workout_id = ? AND id = ?`,
		workoutID, mediaID)
	m, err := scanMedia(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Media{}, ErrMediaNotFound
	}
	return m, err
}

// CountMedia is how the upload handler enforces MaxMediaPerWorkout.
func (r *SQLiteRepository) CountMedia(ctx context.Context, workoutID string) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM workout_media WHERE workout_id = ?`, workoutID).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("count media: %w", err)
	}
	return n, nil
}

// AddMedia records a stored photo. The bytes are already on disk by this point;
// see MediaStore.Save and the ordering note in handleUploadMedia.
func (r *SQLiteRepository) AddMedia(ctx context.Context, m Media) error {
	// Appended, by taking the position after the current highest. COALESCE
	// covers the first photo, where MAX over no rows is NULL.
	_, err := r.db.ExecContext(ctx,
		`INSERT INTO workout_media (`+mediaCols+`)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
		         COALESCE((SELECT MAX(position) + 1 FROM workout_media WHERE workout_id = ?), 0), ?)`,
		m.ID, m.WorkoutID, m.UserID, m.Kind, m.Filename, m.MIME, m.Width, m.Height, m.Bytes, m.Caption,
		m.WorkoutID, m.CreatedAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return fmt.Errorf("add media: %w", err)
	}
	return nil
}

// DeleteMedia removes one photo's row. The file is removed by the caller: see
// handleDeleteMedia for why the row goes first.
func (r *SQLiteRepository) DeleteMedia(ctx context.Context, workoutID, mediaID string) error {
	res, err := r.db.ExecContext(ctx, `DELETE FROM workout_media WHERE workout_id = ? AND id = ?`, workoutID, mediaID)
	if err != nil {
		return fmt.Errorf("delete media: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrMediaNotFound
	}
	return nil
}

// DeleteMediaForUser removes every photo a user added. See the interface for
// why this exists alongside the workout foreign key.
func (r *SQLiteRepository) DeleteMediaForUser(ctx context.Context, userID int64) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM workout_media WHERE user_id = ?`, userID); err != nil {
		return fmt.Errorf("delete media for user: %w", err)
	}
	return nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanMedia(s scanner) (Media, error) {
	var m Media
	var created string
	err := s.Scan(&m.ID, &m.WorkoutID, &m.UserID, &m.Kind, &m.Filename, &m.MIME,
		&m.Width, &m.Height, &m.Bytes, &m.Caption, &m.Position, &created)
	if err != nil {
		return Media{}, err
	}
	m.CreatedAt, _ = time.Parse(time.RFC3339Nano, created)
	return m, nil
}

// ── Disk ──────────────────────────────────────────────────────────────────

// MediaStore holds workout photos on disk, one directory per workout.
//
// A directory per workout rather than one flat pile: deleting a workout is then
// a single RemoveAll instead of a scan, and a human looking at a backup can see
// what belongs to what. Files are named by media id, never by the uploaded
// filename — that string came from a form and is only ever used as a download
// name.
type MediaStore struct {
	dir string
}

// NewMediaStore builds a media store rooted at dataDir.
func NewMediaStore(dataDir string) *MediaStore {
	return &MediaStore{dir: filepath.Join(dataDir, "media")}
}

// Path is where a photo's bytes live. `thumb` selects the small copy.
func (s *MediaStore) Path(workoutID, mediaID string, thumb bool) string {
	name := mediaID + ".jpg"
	if thumb {
		name = mediaID + "_t.jpg"
	}
	return filepath.Join(s.dir, safeSegment(workoutID), name)
}

// Save writes a photo and its thumbnail.
func (s *MediaStore) Save(workoutID, mediaID string, full, thumb []byte) error {
	dir := filepath.Join(s.dir, safeSegment(workoutID))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create media directory: %w", err)
	}
	if err := os.WriteFile(s.Path(workoutID, mediaID, false), full, 0o644); err != nil {
		return fmt.Errorf("write media: %w", err)
	}
	if err := os.WriteFile(s.Path(workoutID, mediaID, true), thumb, 0o644); err != nil {
		// The full image is already written; leaving it without a thumbnail
		// would be a gallery tile that never loads, so it goes too.
		_ = os.Remove(s.Path(workoutID, mediaID, false))
		return fmt.Errorf("write media thumbnail: %w", err)
	}
	return nil
}

// Remove deletes one photo and its thumbnail. A missing file is not an error:
// the row is the record, and a file that has already gone is the state wanted.
func (s *MediaStore) Remove(workoutID, mediaID string) {
	_ = os.Remove(s.Path(workoutID, mediaID, false))
	_ = os.Remove(s.Path(workoutID, mediaID, true))
}

// RemoveWorkout deletes every photo belonging to a workout.
func (s *MediaStore) RemoveWorkout(workoutID string) {
	_ = os.RemoveAll(filepath.Join(s.dir, safeSegment(workoutID)))
}

// safeSegment keeps an id from escaping the media directory.
//
// Workout ids are generated by this application and contain nothing dangerous,
// so this is belt and braces — but it is one line, and the thing it guards
// against is a path traversal that reads or deletes arbitrary files.
func safeSegment(id string) string {
	out := make([]rune, 0, len(id))
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
			out = append(out, r)
		default:
			out = append(out, '_')
		}
	}
	return string(out)
}
