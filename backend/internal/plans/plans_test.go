package plans

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/store"
)

func newTestService(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	// The real schema, not a hand-written copy of it. The copy drifted the
	// first time a column was added: every test here failed on a missing
	// plan_blocks.rest_sec that production had.
	db, err := store.OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.MigrateApp(context.Background(), db); err != nil {
		t.Fatalf("MigrateApp() error = %v", err)
	}
	return NewService(NewSQLiteRepository(db)), db
}

// samplePlan is a chest day: a choose-one block and a plain one.
func samplePlan(t *testing.T, s *Service, userID int64) *Plan {
	t.Helper()
	ctx := context.Background()
	p, err := s.CreatePlan(ctx, userID, PlanInput{Name: "Push / Pull / Legs"})
	if err != nil {
		t.Fatalf("CreatePlan() error = %v", err)
	}
	p, err = s.ReplaceDays(ctx, userID, p.ID, []Day{{
		Name: "Chest & Triceps",
		Blocks: []Block{
			{Options: []Exercise{
				{Name: "Bench press", Sets: 4, Reps: "8", WeightKg: 60},
				{Name: "Push-ups", Sets: 4, Reps: "15"},
			}},
			{Options: []Exercise{{Name: "Cable fly", Sets: 3, Reps: "12", WeightKg: 15}}},
		},
	}})
	if err != nil {
		t.Fatalf("ReplaceDays() error = %v", err)
	}
	return p
}

func TestReplaceDaysRoundTripsTheStructure(t *testing.T) {
	s, _ := newTestService(t)
	p := samplePlan(t, s, 1)

	if len(p.Days) != 1 {
		t.Fatalf("got %d days, want 1", len(p.Days))
	}
	day := p.Days[0]
	if len(day.Blocks) != 2 {
		t.Fatalf("got %d blocks, want 2", len(day.Blocks))
	}
	// Order is the thing most likely to break, since it survives only as a
	// position column that three separate queries have to agree on.
	if got := day.Blocks[0].Options[0].Name; got != "Bench press" {
		t.Errorf("first option = %q, want the bench press", got)
	}
	if got := day.Blocks[0].Options[1].Name; got != "Push-ups" {
		t.Errorf("second option = %q, want the push-ups", got)
	}
	if got := day.Blocks[1].Options[0].Name; got != "Cable fly" {
		t.Errorf("second block = %q, want the cable fly", got)
	}
	if day.Blocks[0].Options[0].ID == "" {
		t.Error("the server issued no id for an exercise the client created")
	}
}

func TestReplaceDaysDropsEmptyBlocks(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p, err := s.CreatePlan(ctx, 1, PlanInput{Name: "Plan"})
	if err != nil {
		t.Fatal(err)
	}
	// The editor creates the block before the name is typed; backing out of
	// that should not be a validation error.
	p, err = s.ReplaceDays(ctx, 1, p.ID, []Day{{
		Name: "Day",
		Blocks: []Block{
			{Options: []Exercise{{Name: "  ", Sets: 3}}},
			{Options: []Exercise{{Name: "Squat", Sets: 5, Reps: "5"}}},
		},
	}})
	if err != nil {
		t.Fatalf("ReplaceDays() error = %v", err)
	}
	if len(p.Days[0].Blocks) != 1 {
		t.Fatalf("got %d blocks, want the empty one dropped", len(p.Days[0].Blocks))
	}
}

func TestPlansAreScopedToTheirOwner(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)

	if _, err := s.GetPlan(ctx, 2, p.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user reading the plan: %v, want ErrNotFound", err)
	}
	if _, err := s.ReplaceDays(ctx, 2, p.ID, []Day{{Name: "Mine now"}}); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user rewriting the days: %v, want ErrNotFound", err)
	}
	if err := s.DeletePlan(ctx, 2, p.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user deleting the plan: %v, want ErrNotFound", err)
	}
	// And the plan is still whole after all three.
	got, err := s.GetPlan(ctx, 1, p.ID)
	if err != nil || len(got.Days) != 1 || len(got.Days[0].Blocks) != 2 {
		t.Fatalf("owner's plan was damaged: %+v, err = %v", got, err)
	}
}

func TestSessionSnapshotSurvivesEditingThePlan(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)

	sess, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	if err != nil {
		t.Fatalf("StartSession() error = %v", err)
	}

	// The whole point of the snapshot: history shows what was followed, not
	// what the plan says today.
	if _, err := s.ReplaceDays(ctx, 1, p.ID, []Day{{
		ID:     p.Days[0].ID,
		Name:   "Chest & Triceps",
		Blocks: []Block{{Options: []Exercise{{Name: "Bench press", Sets: 10, Reps: "3", WeightKg: 100}}}},
	}}); err != nil {
		t.Fatalf("ReplaceDays() error = %v", err)
	}

	got, err := s.GetSession(ctx, 1, sess.ID)
	if err != nil {
		t.Fatalf("GetSession() error = %v", err)
	}
	if len(got.Snapshot.Blocks) != 2 {
		t.Fatalf("snapshot has %d blocks, want the 2 it started with", len(got.Snapshot.Blocks))
	}
	if w := got.Snapshot.Blocks[0].Options[0].WeightKg; w != 60 {
		t.Errorf("snapshot weight = %v, want the 60 kg that was planned at the time", w)
	}
}

func TestSessionOutlivesItsPlan(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	sess, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.FinishSession(ctx, 1, sess.ID, "", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.DeletePlan(ctx, 1, p.ID); err != nil {
		t.Fatalf("DeletePlan() error = %v", err)
	}

	got, err := s.GetSession(ctx, 1, sess.ID)
	if err != nil {
		t.Fatalf("GetSession() after deleting the plan: %v", err)
	}
	if got.PlanID != "" {
		t.Errorf("planId = %q, want it cleared with the plan", got.PlanID)
	}
	if got.PlanName != "Push / Pull / Legs" || got.DayName != "Chest & Triceps" {
		t.Errorf("session forgot what it was: %q / %q", got.PlanName, got.DayName)
	}
	if len(got.Snapshot.Blocks) != 2 {
		t.Error("the snapshot went with the plan")
	}
}

func TestOnlyOneSessionRunsAtATime(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)

	first, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID); !errors.Is(err, ErrSessionRunning) {
		t.Errorf("second start: %v, want ErrSessionRunning", err)
	}
	// Another user is not blocked by someone else's session.
	other := samplePlan(t, s, 2)
	if _, err := s.StartSession(ctx, 2, other.ID, other.Days[0].ID); err != nil {
		t.Errorf("a second user could not start: %v", err)
	}
	if _, err := s.FinishSession(ctx, 1, first.ID, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID); err != nil {
		t.Errorf("starting after finishing: %v", err)
	}
}

func TestStatsCountTheChosenAlternative(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	sess, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	bench, fly := sess.Snapshot.Blocks[0], sess.Snapshot.Blocks[1]

	// 4 sets of bench at 60 kg × 8, of which three done; the last heavier.
	// Push-ups (the unpicked option) must not contribute.
	got, err := s.SaveProgress(ctx, 1, sess.ID, Progress{Blocks: map[string]BlockProgress{
		bench.ID: {Pick: 0, Sets: []SetLog{
			{Done: true},
			{Done: true},
			{Done: true, WeightKg: 65},
			{Done: false},
		}},
		fly.ID: {Sets: []SetLog{{Done: true}}},
	}})
	if err != nil {
		t.Fatalf("SaveProgress() error = %v", err)
	}

	if got.TotalSets != 7 {
		t.Errorf("totalSets = %d, want 7 (4 bench + 3 fly)", got.TotalSets)
	}
	if got.DoneSets != 4 {
		t.Errorf("doneSets = %d, want 4", got.DoneSets)
	}
	// 60×8 + 60×8 + 65×8 for the bench, 15×12 for the fly.
	if want := 60.0*8 + 60*8 + 65*8 + 15*12; got.VolumeKg != want {
		t.Errorf("volumeKg = %v, want %v", got.VolumeKg, want)
	}
}

func TestPickingAnAlternativeChangesTheTargets(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	sess, _ := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	bench := sess.Snapshot.Blocks[0]

	// Push-ups: bodyweight, so they add sets but no volume — the number people
	// would otherwise expect to see inflated by 60 kg per rep.
	got, err := s.SaveProgress(ctx, 1, sess.ID, Progress{Blocks: map[string]BlockProgress{
		bench.ID: {Pick: 1, Sets: []SetLog{{Done: true}, {Done: true}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got.DoneSets != 2 {
		t.Errorf("doneSets = %d, want 2", got.DoneSets)
	}
	if got.VolumeKg != 0 {
		t.Errorf("volumeKg = %v, want 0 for bodyweight push-ups", got.VolumeKg)
	}
}

func TestDurationRepsAddNoVolume(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	pl, err := s.CreatePlan(ctx, 1, PlanInput{Name: "Core"})
	if err != nil {
		t.Fatal(err)
	}
	pl, err = s.ReplaceDays(ctx, 1, pl.ID, []Day{{
		Name:   "Core",
		Blocks: []Block{{Options: []Exercise{{Name: "Plank", Sets: 3, Reps: "45 s", WeightKg: 0}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	sess, _ := s.StartSession(ctx, 1, pl.ID, pl.Days[0].ID)
	got, err := s.SaveProgress(ctx, 1, sess.ID, Progress{Blocks: map[string]BlockProgress{
		sess.Snapshot.Blocks[0].ID: {Sets: []SetLog{{Done: true}, {Done: true}, {Done: true}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got.DoneSets != 3 {
		t.Errorf("doneSets = %d, want 3", got.DoneSets)
	}
	// 45 seconds of plank is not 45 kilograms lifted.
	if got.VolumeKg != 0 {
		t.Errorf("volumeKg = %v, want 0 for a held position", got.VolumeKg)
	}
}

func TestFinishedSessionsRejectFurtherProgress(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	sess, _ := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	if _, err := s.FinishSession(ctx, 1, sess.ID, "done", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveProgress(ctx, 1, sess.ID, Progress{}); !errors.Is(err, ErrInvalid) {
		t.Errorf("writing to a finished session: %v, want ErrInvalid", err)
	}
	if _, err := s.FinishSession(ctx, 1, sess.ID, "", ""); !errors.Is(err, ErrInvalid) {
		t.Errorf("finishing twice: %v, want ErrInvalid", err)
	}
}

func TestActiveSessionIsPerUser(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	if _, err := s.ActiveSession(ctx, 1); !errors.Is(err, ErrNotFound) {
		t.Errorf("with nothing running: %v, want ErrNotFound", err)
	}
	started, _ := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)

	got, err := s.ActiveSession(ctx, 1)
	if err != nil || got.ID != started.ID {
		t.Fatalf("ActiveSession() = %+v, %v", got, err)
	}
	if _, err := s.ActiveSession(ctx, 2); !errors.Is(err, ErrNotFound) {
		t.Errorf("another user saw it: %v", err)
	}
	if _, err := s.FinishSession(ctx, 1, started.ID, "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ActiveSession(ctx, 1); !errors.Is(err, ErrNotFound) {
		t.Error("a finished session is still reported as active")
	}
}

func TestClientSuppliedIdsAreOnlyKeptInTheShapeWeIssue(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p, err := s.CreatePlan(ctx, 1, PlanInput{Name: "Plan"})
	if err != nil {
		t.Fatal(err)
	}
	// Keeping ids is what lets a running session still match its blocks after
	// an edit — but only ids of ours, since they end up in URLs and JSON.
	mine := "pd_0123456789abcdef01234567"
	p, err = s.ReplaceDays(ctx, 1, p.ID, []Day{
		{ID: mine, Name: "Kept", Blocks: []Block{{ID: "<script>", Options: []Exercise{{Name: "Row", Sets: 3}}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if p.Days[0].ID != mine {
		t.Errorf("day id = %q, want the well-formed one kept", p.Days[0].ID)
	}
	if got := p.Days[0].Blocks[0].ID; got == "<script>" {
		t.Errorf("block id = %q, want it replaced with a generated one", got)
	}
}

func TestPurgeUserRemovesOnlyThatUsersPlans(t *testing.T) {
	s, db := newTestService(t)
	ctx := context.Background()
	mine := samplePlan(t, s, 1)
	theirs := samplePlan(t, s, 2)
	if _, err := s.StartSession(ctx, 1, mine.ID, mine.Days[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.StartSession(ctx, 2, theirs.ID, theirs.Days[0].ID); err != nil {
		t.Fatal(err)
	}

	if err := s.PurgeUser(ctx, 1); err != nil {
		t.Fatalf("PurgeUser() error = %v", err)
	}
	if _, err := s.GetPlan(ctx, 1, mine.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("plan survived the purge: %v", err)
	}
	if _, err := s.ActiveSession(ctx, 1); !errors.Is(err, ErrNotFound) {
		t.Error("session survived the purge")
	}
	if _, err := s.GetPlan(ctx, 2, theirs.ID); err != nil {
		t.Errorf("the other user's plan was taken too: %v", err)
	}
	// The cascade has to reach the leaves, or the next purge test passes over
	// rows that are still there.
	var left int
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM plan_exercises e
		JOIN plan_blocks b ON b.id = e.block_id
		JOIN plan_days d ON d.id = b.day_id WHERE d.plan_id = ?`, mine.ID).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Errorf("%d exercises orphaned after the plan was purged", left)
	}
}
