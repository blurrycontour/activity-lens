package workout

import (
	"context"
	"testing"
	"time"
)

// London, Paris and a treadmill.
func trackInput(name string, route []LatLng, day int) Input {
	return Input{
		Name:      name,
		Type:      TypeRun,
		StartTime: time.Date(2024, 5, day, 7, 0, 0, 0, time.UTC),
		Duration:  1800,
		Distance:  5000,
		Source:    SourceUpload,
		Route:     route,
	}
}

func london() []LatLng {
	return []LatLng{{51.50, -0.12}, {51.51, -0.11}, {51.52, -0.10}, {51.51, -0.13}}
}

func paris() []LatLng {
	return []LatLng{{48.85, 2.29}, {48.86, 2.31}, {48.87, 2.33}}
}

func TestTracksAreWrittenAtImport(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	if _, err := svc.Create(ctx, 1, trackInput("run", london(), 4)); err != nil {
		t.Fatalf("create: %v", err)
	}
	got, err := repo.ListTracks(ctx, 1, TrackQuery{})
	if err != nil || len(got) != 1 {
		t.Fatalf("ListTracks = %d rows, err %v, want 1", len(got), err)
	}
	if len(got[0].Points) < 2 {
		t.Errorf("track has %d points", len(got[0].Points))
	}
	if got[0].Name != "run" || got[0].Date != "2024-05-04" {
		t.Errorf("track = %+v", got[0])
	}
}

// The bounding-box filter is what keeps a pan from reading the whole library,
// and it is also the thing that silently returns nothing if the coordinate
// order is wrong anywhere along the way.
func TestTracksFilterByViewport(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	if _, err := svc.Create(ctx, 1, trackInput("london", london(), 4)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, 1, trackInput("paris", paris(), 5)); err != nil {
		t.Fatal(err)
	}

	overLondon := Bounds{MinLat: 51.4, MaxLat: 51.6, MinLon: -0.3, MaxLon: 0.1}
	got, err := repo.ListTracks(ctx, 1, TrackQuery{Box: overLondon})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Name != "london" {
		t.Fatalf("viewport over London returned %d tracks %v", len(got), names(got))
	}

	// Overlap, not containment: a route running off the edge of the screen is
	// still on the screen. Testing containment would make long rides disappear
	// as you zoom in on them, which looks like a loading bug.
	sliver := Bounds{MinLat: 51.505, MaxLat: 51.512, MinLon: -0.115, MaxLon: -0.112}
	if got, err := repo.ListTracks(ctx, 1, TrackQuery{Box: sliver}); err != nil || len(got) != 1 {
		t.Errorf("a route crossing the viewport returned %d tracks, err %v", len(got), err)
	}

	// No box at all means everything, which is what the first load asks.
	if got, err := repo.ListTracks(ctx, 1, TrackQuery{}); err != nil || len(got) != 2 {
		t.Errorf("unbounded query returned %d tracks, err %v, want 2", len(got), err)
	}
}

func TestTracksFilterByDate(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	for _, day := range []int{4, 10, 20} {
		if _, err := svc.Create(ctx, 1, trackInput("run", london(), day)); err != nil {
			t.Fatal(err)
		}
	}
	q := TrackQuery{
		From: time.Date(2024, 5, 9, 0, 0, 0, 0, time.UTC),
		To:   time.Date(2024, 5, 11, 0, 0, 0, 0, time.UTC),
	}
	if got, err := repo.ListTracks(ctx, 1, q); err != nil || len(got) != 1 {
		t.Errorf("date filter returned %d tracks, err %v, want 1", len(got), err)
	}
}

// Another user's routes are their movements. This is the one bug here that is
// not merely a wrong picture.
func TestTracksAreOwnerScoped(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	if _, err := svc.Create(ctx, 1, trackInput("mine", london(), 4)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, 2, trackInput("theirs", london(), 4)); err != nil {
		t.Fatal(err)
	}
	got, err := repo.ListTracks(ctx, 1, TrackQuery{})
	if err != nil || len(got) != 1 || got[0].Name != "mine" {
		t.Fatalf("ListTracks leaked across users: %v", names(got))
	}
}

// A treadmill run has no route. It must not become a track at the equator,
// which is where a zero bounding box points and where it would match a viewport
// over the Gulf of Guinea.
func TestIndoorWorkoutsAreNotOnTheMap(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	if _, err := svc.Create(ctx, 1, trackInput("treadmill", nil, 4)); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Create(ctx, 1, trackInput("no lock yet", []LatLng{{0, 0}, {0, 0}}, 5)); err != nil {
		t.Fatal(err)
	}
	if got, err := repo.ListTracks(ctx, 1, TrackQuery{}); err != nil || len(got) != 0 {
		t.Errorf("indoor workouts appeared on the map: %v (err %v)", names(got), err)
	}
	// And they are settled rather than queued, or the backfill would grind over
	// them forever and never reach anything else.
	if n, err := repo.CountMissingTracks(ctx, 1); err != nil || n != 0 {
		t.Errorf("missing = %d, err %v, want 0 — routeless workouts should be settled", n, err)
	}
}

// Everything imported before this feature has no track. The backfill has to
// find them, and — the part that goes wrong — stop finding them afterwards.
func TestBackfillSettlesEveryRowItTouches(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	outdoor, err := svc.Create(ctx, 1, trackInput("legacy run", london(), 4))
	if err != nil {
		t.Fatal(err)
	}
	indoor, err := svc.Create(ctx, 1, trackInput("legacy treadmill", nil, 5))
	if err != nil {
		t.Fatal(err)
	}
	// Stand in for rows that predate the migration: it defaults every column to
	// zero and cannot read the route blob to do better.
	for _, id := range []string{outdoor.ID, indoor.ID} {
		if _, err := repo.db.ExecContext(ctx,
			`UPDATE workouts SET track = NULL, track_points = 0,
			 bbox_min_lat = 0, bbox_max_lat = 0, bbox_min_lon = 0, bbox_max_lon = 0
			 WHERE id = ?`, id); err != nil {
			t.Fatal(err)
		}
	}

	if n, err := repo.CountMissingTracks(ctx, 1); err != nil || n != 2 {
		t.Fatalf("missing = %d, err %v, want 2", n, err)
	}
	pending, err := repo.ListMissingTracks(ctx, 10)
	if err != nil || len(pending) != 2 {
		t.Fatalf("ListMissingTracks = %d, err %v, want 2", len(pending), err)
	}
	for _, item := range pending {
		if err := repo.SetTrack(ctx, item.ID, item.Route); err != nil {
			t.Fatalf("SetTrack: %v", err)
		}
	}

	// The outdoor one is now drawable...
	got, err := repo.ListTracks(ctx, 1, TrackQuery{})
	if err != nil || len(got) != 1 || got[0].Name != "legacy run" {
		t.Fatalf("after the backfill: %v (err %v)", names(got), err)
	}
	// ...and neither is queued any more. Without the sentinel box, the indoor
	// one would still look untouched and be re-simplified on every pass.
	if n, err := repo.CountMissingTracks(ctx, 1); err != nil || n != 0 {
		t.Errorf("missing = %d after the backfill, want 0", n)
	}
	if again, err := repo.ListMissingTracks(ctx, 10); err != nil || len(again) != 0 {
		t.Errorf("the backfill would run again over %d rows", len(again))
	}
}

func TestTracksRespectTheLimit(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	for day := 1; day <= 5; day++ {
		if _, err := svc.Create(ctx, 1, trackInput("run", london(), day)); err != nil {
			t.Fatal(err)
		}
	}
	got, err := repo.ListTracks(ctx, 1, TrackQuery{Limit: 3})
	if err != nil || len(got) != 3 {
		t.Fatalf("limit 3 returned %d, err %v", len(got), err)
	}
	// Newest first, so a capped answer is the recent half of the library rather
	// than an arbitrary slice of it.
	if got[0].Date != "2024-05-05" {
		t.Errorf("first track is %s, want the newest", got[0].Date)
	}
}

func names(ts []Track) []string {
	out := make([]string, len(ts))
	for i, t := range ts {
		out[i] = t.Name
	}
	return out
}
