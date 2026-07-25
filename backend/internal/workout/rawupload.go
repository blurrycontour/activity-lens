package workout

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
)

// RawUploadStore persists original imported activity files under the configured
// data directory, gated by an admin-configurable setting.
type RawUploadStore struct {
	dir string
}

// NewRawUploadStore builds a raw-upload store rooted at dataDir.
func NewRawUploadStore(dataDir string) *RawUploadStore {
	return &RawUploadStore{dir: filepath.Join(dataDir, "raw-uploads")}
}

// Save stores the original file as <workout ID><original extension>.
func (s *RawUploadStore) Save(ctx context.Context, workoutID, filename, contentType string, data []byte) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := os.MkdirAll(s.dir, 0o750); err != nil {
		return fmt.Errorf("create raw uploads directory: %w", err)
	}
	ext := filepath.Ext(filepath.Base(filename))
	if ext == "" {
		ext = ".bin"
	}
	path := filepath.Join(s.dir, workoutID+ext)
	tmp, err := os.CreateTemp(s.dir, ".upload-*")
	if err != nil {
		return fmt.Errorf("create raw upload: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write raw upload: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close raw upload: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("save raw upload: %w", err)
	}
	return nil
}
