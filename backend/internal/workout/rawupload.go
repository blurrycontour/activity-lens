package workout

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// RawUploadStore persists the original bytes of an imported activity file
// (GPX/TCX), gated by an admin-configurable setting. Kept separate from the
// workouts table so ordinary workout reads/writes never touch these larger
// blobs; rows are removed automatically (ON DELETE CASCADE) when the owning
// workout is deleted.
type RawUploadStore struct {
	db *sql.DB
}

// NewRawUploadStore builds a raw-upload store backed by db.
func NewRawUploadStore(db *sql.DB) *RawUploadStore { return &RawUploadStore{db: db} }

// Save stores (or replaces) the original uploaded file for a workout.
func (s *RawUploadStore) Save(ctx context.Context, workoutID, filename, contentType string, data []byte) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO workout_raw_uploads (workout_id, filename, content_type, data, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(workout_id) DO UPDATE SET
			filename = excluded.filename,
			content_type = excluded.content_type,
			data = excluded.data,
			created_at = excluded.created_at`,
		workoutID, filename, contentType, data, time.Now().UTC().Format(time.RFC3339))
	if err != nil {
		return fmt.Errorf("save raw upload: %w", err)
	}
	return nil
}
