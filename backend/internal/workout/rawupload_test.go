package workout

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/klauspost/compress/zstd"
)

func TestRawUploadStoreSaveCompresses(t *testing.T) {
	dir := t.TempDir()
	s := NewRawUploadStore(dir)

	// Repetitive XML like a real TCX export, so the ratio is meaningful.
	var b strings.Builder
	b.WriteString(`<?xml version="1.0"?><TrainingCenterDatabase><Activities><Activity Sport="Running"><Lap><Track>`)
	for i := 0; i < 2000; i++ {
		b.WriteString(`<Trackpoint><Time>2024-01-10T06:00:00Z</Time><HeartRateBpm><Value>142</Value></HeartRateBpm></Trackpoint>`)
	}
	b.WriteString(`</Track></Lap></Activity></Activities></TrainingCenterDatabase>`)
	original := []byte(b.String())

	if err := s.Save(context.Background(), "w_test", "morning.tcx", "application/xml", original); err != nil {
		t.Fatal(err)
	}

	path := filepath.Join(dir, "raw-uploads", "w_test.tcx.zst")
	stored, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("expected file at %s: %v", path, err)
	}
	if len(stored) >= len(original)/10 {
		t.Errorf("stored %d bytes for %d bytes of XML, expected better than 10:1", len(stored), len(original))
	}

	dec, err := zstd.NewReader(nil)
	if err != nil {
		t.Fatal(err)
	}
	defer dec.Close()
	got, err := dec.DecodeAll(stored, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, original) {
		t.Error("decompressed file does not match the original upload")
	}

	// No temp files may be left behind next to the saved upload.
	entries, err := os.ReadDir(filepath.Join(dir, "raw-uploads"))
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Errorf("raw-uploads contains %d entries, want only the saved file", len(entries))
	}
}
