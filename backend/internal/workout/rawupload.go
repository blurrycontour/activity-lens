package workout

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

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
