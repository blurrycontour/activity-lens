package workout

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/zstd"
)

// rawUploadExt is appended to the original extension of every stored file so
// the compression is obvious on disk (e.g. w_abc.gpx.zst).
const rawUploadExt = ".zst"

// rawEncoder is shared: a zstd encoder is safe for concurrent use and holds a
// sizeable window buffer, so building one per upload would be wasteful.
// SpeedBestCompression trades CPU for ratio, which is the right side of the
// trade for write-once archival files that are almost never read back.
var rawEncoder, _ = zstd.NewWriter(nil,
	zstd.WithEncoderLevel(zstd.SpeedBestCompression),
	zstd.WithWindowSize(1<<22),
)

// RawUploadStore persists original imported activity files under the configured
// data directory, gated by an admin-configurable setting. Files are stored
// zstd-compressed; activity XML compresses roughly 10:1, which matters once a
// library grows to thousands of imports.
type RawUploadStore struct {
	dir string
}

// NewRawUploadStore builds a raw-upload store rooted at dataDir.
func NewRawUploadStore(dataDir string) *RawUploadStore {
	return &RawUploadStore{dir: filepath.Join(dataDir, "raw-uploads")}
}

// Delete removes the archived file for a workout, if one was ever kept.
//
// The stored name is <workout ID><original extension>.zst and the extension
// comes from whatever the user uploaded, so the exact filename is not derivable
// from the id alone — the directory is scanned instead.
//
// Missing files are not an error: archiving is an admin-configurable setting,
// so a workout imported while it was off has nothing to remove.
func (s *RawUploadStore) Delete(ctx context.Context, workoutID string) error {
	return s.DeleteMany(ctx, []string{workoutID})
}

// DeleteMany removes the archived files for many workouts in a single directory
// scan. Deleting an account can mean thousands of workouts at once, and calling
// Delete in a loop would re-read the whole directory for each one.
//
// Names are matched by splitting at the first dot rather than by prefix, which
// is exact: Save always writes <id><ext>.zst and substitutes ".bin" when the
// upload had no extension, so every stored name contains a dot and everything
// before the first one is the workout id. That is also what stops one id from
// matching another's file when it happens to be a prefix of it.
func (s *RawUploadStore) DeleteMany(ctx context.Context, workoutIDs []string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if len(workoutIDs) == 0 {
		return nil
	}
	wanted := make(map[string]struct{}, len(workoutIDs))
	for _, id := range workoutIDs {
		wanted[id] = struct{}{}
	}
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read raw uploads directory: %w", err)
	}
	for _, e := range entries {
		name := e.Name()
		dot := strings.IndexByte(name, '.')
		if e.IsDir() || dot <= 0 {
			continue
		}
		if _, ok := wanted[name[:dot]]; !ok {
			continue
		}
		if err := os.Remove(filepath.Join(s.dir, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("delete raw upload: %w", err)
		}
	}
	return nil
}

// Save stores the original file as <workout ID><original extension>.zst.
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
	path := filepath.Join(s.dir, workoutID+ext+rawUploadExt)
	tmp, err := os.CreateTemp(s.dir, ".upload-*")
	if err != nil {
		return fmt.Errorf("create raw upload: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if _, err := tmp.Write(rawEncoder.EncodeAll(data, nil)); err != nil {
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
