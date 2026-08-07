package store

import (
	"context"
	"path/filepath"
	"testing"
)

// The migration has to be safe to run on every startup, like every other one.
func TestTrackMigrationIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.db")
	for i := 0; i < 3; i++ {
		db, err := OpenSQLite(path)
		if err != nil {
			t.Fatalf("open %d: %v", i, err)
		}
		if err := MigrateApp(context.Background(), db); err != nil {
			t.Fatalf("migrate %d: %v", i, err)
		}
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('workouts')
			WHERE name IN ('track','track_points','bbox_min_lat','bbox_max_lat','bbox_min_lon','bbox_max_lon')`).Scan(&n); err != nil {
			t.Fatalf("pragma: %v", err)
		}
		if n != 6 {
			t.Fatalf("run %d: found %d of 6 track columns", i, n)
		}
		_ = db.Close()
	}
}
