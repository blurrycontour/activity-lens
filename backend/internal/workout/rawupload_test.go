package workout

import (
	"bytes"
	"context"
	"errors"
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

// Deleting a workout has to take its archived upload with it, or the data
// directory grows forever with files nothing references.
func TestRawUploadStoreDeleteRemovesFile(t *testing.T) {
	dir := t.TempDir()
	store := NewRawUploadStore(dir)
	ctx := context.Background()

	if err := store.Save(ctx, "w_abc", "ride.gpx", "application/gpx+xml", []byte("<gpx/>")); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	if got := countFiles(t, filepath.Join(dir, "raw-uploads")); got != 1 {
		t.Fatalf("expected the archive to exist, found %d files", got)
	}

	if err := store.Delete(ctx, "w_abc"); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}
	if got := countFiles(t, filepath.Join(dir, "raw-uploads")); got != 0 {
		t.Fatalf("%d files left after Delete()", got)
	}
}

// The filename carries the uploaded extension, so the delete has to find the
// file whatever it was imported as.
func TestRawUploadStoreDeleteHandlesAnyExtension(t *testing.T) {
	ctx := context.Background()
	for _, name := range []string{"a.gpx", "a.tcx", "a.TCX", "noextension"} {
		dir := t.TempDir()
		store := NewRawUploadStore(dir)
		if err := store.Save(ctx, "w_abc", name, "", []byte("x")); err != nil {
			t.Fatalf("Save(%q) error = %v", name, err)
		}
		if err := store.Delete(ctx, "w_abc"); err != nil {
			t.Fatalf("Delete() after %q error = %v", name, err)
		}
		if got := countFiles(t, filepath.Join(dir, "raw-uploads")); got != 0 {
			t.Errorf("%q left %d files behind", name, got)
		}
	}
}

// Matching on the id alone would let one workout's delete take another's file
// when one id is a prefix of the other. Splitting the stored name at its first
// dot is what prevents it.
func TestRawUploadStoreDeleteLeavesOtherWorkoutsAlone(t *testing.T) {
	dir := t.TempDir()
	store := NewRawUploadStore(dir)
	ctx := context.Background()

	for _, id := range []string{"w_abc", "w_abcdef"} {
		if err := store.Save(ctx, id, "r.gpx", "", []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Delete(ctx, "w_abc"); err != nil {
		t.Fatalf("Delete() error = %v", err)
	}

	remaining := filepath.Join(dir, "raw-uploads", "w_abcdef.gpx.zst")
	if _, err := os.Stat(remaining); err != nil {
		t.Fatalf("deleting w_abc also removed w_abcdef's archive: %v", err)
	}
	if got := countFiles(t, filepath.Join(dir, "raw-uploads")); got != 1 {
		t.Fatalf("expected exactly the other workout's file to remain, found %d", got)
	}
}

// Archiving is an admin setting, so plenty of workouts never had a file. That
// must not make deleting them an error.
func TestRawUploadStoreDeleteIsQuietWhenNothingStored(t *testing.T) {
	ctx := context.Background()

	// Directory exists but holds nothing for this workout.
	dir := t.TempDir()
	store := NewRawUploadStore(dir)
	if err := store.Save(ctx, "w_other", "r.gpx", "", []byte("x")); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(ctx, "w_missing"); err != nil {
		t.Errorf("Delete() for a workout with no archive: %v", err)
	}

	// Directory never created at all — archiving has been off since install.
	fresh := NewRawUploadStore(t.TempDir())
	if err := fresh.Delete(ctx, "w_missing"); err != nil {
		t.Errorf("Delete() with no raw-uploads directory: %v", err)
	}
}

func countFiles(t *testing.T, dir string) int {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return 0
	}
	if err != nil {
		t.Fatal(err)
	}
	return len(entries)
}

// Deleting an account can mean thousands of workouts, so the purge hands the
// whole id list over at once rather than calling Delete in a loop. It must
// still be exact about which files it takes.
func TestRawUploadStoreDeleteManyRemovesExactlyTheGivenWorkouts(t *testing.T) {
	dir := t.TempDir()
	store := NewRawUploadStore(dir)
	ctx := context.Background()

	for _, id := range []string{"w_one", "w_two", "w_three", "w_keep"} {
		if err := store.Save(ctx, id, "r.gpx", "", []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.DeleteMany(ctx, []string{"w_one", "w_two", "w_three"}); err != nil {
		t.Fatalf("DeleteMany() error = %v", err)
	}

	if got := countFiles(t, filepath.Join(dir, "raw-uploads")); got != 1 {
		t.Fatalf("%d files left, want only w_keep's", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "raw-uploads", "w_keep.gpx.zst")); err != nil {
		t.Errorf("the file that should have survived is gone: %v", err)
	}
}

// An id that is a prefix of another must not drag its neighbour's file along,
// the same guarantee Delete makes — DeleteMany matches on the id up to the
// first dot rather than on a raw prefix.
func TestRawUploadStoreDeleteManyLeavesPrefixNeighboursAlone(t *testing.T) {
	dir := t.TempDir()
	store := NewRawUploadStore(dir)
	ctx := context.Background()

	for _, id := range []string{"w_abc", "w_abcdef"} {
		if err := store.Save(ctx, id, "r.gpx", "", []byte("x")); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.DeleteMany(ctx, []string{"w_abc"}); err != nil {
		t.Fatalf("DeleteMany() error = %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "raw-uploads", "w_abcdef.gpx.zst")); err != nil {
		t.Errorf("deleting w_abc took w_abcdef's file: %v", err)
	}
}

// An empty list must not be read as "delete everything".
func TestRawUploadStoreDeleteManyWithNoIDsIsANoOp(t *testing.T) {
	dir := t.TempDir()
	store := NewRawUploadStore(dir)
	ctx := context.Background()

	if err := store.Save(ctx, "w_abc", "r.gpx", "", []byte("x")); err != nil {
		t.Fatal(err)
	}
	if err := store.DeleteMany(ctx, nil); err != nil {
		t.Fatalf("DeleteMany(nil) error = %v", err)
	}
	if got := countFiles(t, filepath.Join(dir, "raw-uploads")); got != 1 {
		t.Errorf("DeleteMany(nil) removed files: %d left, want 1", got)
	}
}

// The point of archiving is being able to hand the exact bytes back, so a
// round-trip through Save and Open must be lossless.
func TestRawUploadStoreOpenReturnsTheOriginalBytes(t *testing.T) {
	dir := t.TempDir()
	store := NewRawUploadStore(dir)
	ctx := context.Background()
	original := []byte(`<?xml version="1.0"?><gpx creator="Garmin"><trk/></gpx>`)

	if err := store.Save(ctx, "w_abc", "morning run.gpx", "application/gpx+xml", original); err != nil {
		t.Fatal(err)
	}
	got, err := store.Open(ctx, "w_abc", "morning run.gpx")
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if !bytes.Equal(got, original) {
		t.Errorf("Open() returned %q, want the original %q", got, original)
	}
}

// Save and Open have to agree on the on-disk name for every extension, since
// only the recorded filename tells Open where to look.
func TestRawUploadStoreOpenFindsEveryExtension(t *testing.T) {
	ctx := context.Background()
	for _, name := range []string{"a.gpx", "a.tcx", "a.TCX", "noextension", "dotted.name.gpx"} {
		dir := t.TempDir()
		store := NewRawUploadStore(dir)
		if err := store.Save(ctx, "w_abc", name, "", []byte("payload")); err != nil {
			t.Fatalf("Save(%q) error = %v", name, err)
		}
		got, err := store.Open(ctx, "w_abc", name)
		if err != nil {
			t.Errorf("Open() after saving %q: %v", name, err)
			continue
		}
		if string(got) != "payload" {
			t.Errorf("Open() after saving %q returned %q", name, got)
		}
	}
}

// Most workouts have no archive — keeping originals is off by default — so
// "nothing to download" must be an ordinary answer, not a failure.
func TestRawUploadStoreOpenReportsNothingArchived(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	store := NewRawUploadStore(dir)

	// Imported while archiving was off: no filename was ever recorded.
	if _, err := store.Open(ctx, "w_abc", ""); !errors.Is(err, ErrNoRawUpload) {
		t.Errorf("Open() with no recorded filename = %v, want ErrNoRawUpload", err)
	}
	// A recorded filename whose file is not there — a pruned or moved data
	// directory. Still "nothing to download" as far as the caller is concerned.
	if _, err := store.Open(ctx, "w_abc", "gone.gpx"); !errors.Is(err, ErrNoRawUpload) {
		t.Errorf("Open() with a missing file = %v, want ErrNoRawUpload", err)
	}
}
