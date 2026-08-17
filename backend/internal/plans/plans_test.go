package plans

import (
	"context"
	"database/sql"
	"encoding/json"
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
		bench.ID: {Picks: []int{0}, Sets: map[string][]SetLog{
			bench.Options[0].ID: {
				{Done: true},
				{Done: true},
				{Done: true, WeightKg: 65},
				{Done: false},
			},
		}},
		fly.ID: {Sets: map[string][]SetLog{fly.Options[0].ID: {{Done: true}}}},
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
		bench.ID: {Picks: []int{1}, Sets: map[string][]SetLog{
			bench.Options[1].ID: {{Done: true}, {Done: true}},
		}},
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
		Blocks: []Block{{Options: []Exercise{{Name: "Plank", Kind: KindTime, Sets: 3, DurationSec: 45}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	sess, _ := s.StartSession(ctx, 1, pl.ID, pl.Days[0].ID)
	block := sess.Snapshot.Blocks[0]
	got, err := s.SaveProgress(ctx, 1, sess.ID, Progress{Blocks: map[string]BlockProgress{
		block.ID: {Sets: map[string][]SetLog{block.Options[0].ID: {{Done: true}, {Done: true}, {Done: true}}}},
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

// --- blocks that are not "choose one" ------------------------------------

func supersetPlan(t *testing.T, s *Service, userID int64) *Plan {
	t.Helper()
	ctx := context.Background()
	p, err := s.CreatePlan(ctx, userID, PlanInput{Name: "Arms"})
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.ReplaceDays(ctx, userID, p.ID, []Day{{
		Name: "Superset day",
		Blocks: []Block{{
			Required: 2,
			Options: []Exercise{
				{Name: "Barbell curl", Sets: 3, Reps: "10", WeightKg: 25},
				{Name: "Rope pushdown", Sets: 3, Reps: "12", WeightKg: 20},
			},
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestSupersetCountsEveryExerciseInTheBlock(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := supersetPlan(t, s, 1)
	sess, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	if err != nil {
		t.Fatal(err)
	}

	// Both exercises count towards the total before anything is ticked — a
	// superset is not a choice, so nothing is waiting to be decided.
	if sess.TotalSets != 6 {
		t.Errorf("totalSets = %d, want 6 (3 + 3)", sess.TotalSets)
	}

	block := sess.Snapshot.Blocks[0]
	got, err := s.SaveProgress(ctx, 1, sess.ID, Progress{Blocks: map[string]BlockProgress{
		block.ID: {Sets: map[string][]SetLog{
			block.Options[0].ID: {{Done: true}, {Done: true}},
			block.Options[1].ID: {{Done: true}},
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got.DoneSets != 3 {
		t.Errorf("doneSets = %d, want 3 across both exercises", got.DoneSets)
	}
	if want := 25.0*10*2 + 20*12; got.VolumeKg != want {
		t.Errorf("volumeKg = %v, want %v", got.VolumeKg, want)
	}
}

func TestRequiredIsClampedToWhatTheBlockHolds(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p, err := s.CreatePlan(ctx, 1, PlanInput{Name: "Plan"})
	if err != nil {
		t.Fatal(err)
	}
	// "Do 5 of these" means nothing when there are two, and zero from an
	// older client has to read as the choose-one it used to be.
	p, err = s.ReplaceDays(ctx, 1, p.ID, []Day{{
		Name: "Day",
		Blocks: []Block{
			{Required: 5, Options: []Exercise{{Name: "A", Sets: 1}, {Name: "B", Sets: 1}}},
			{Required: 0, Options: []Exercise{{Name: "C", Sets: 1}, {Name: "D", Sets: 1}}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if got := p.Days[0].Blocks[0].Required; got != 2 {
		t.Errorf("required = %d, want it clamped to the 2 options", got)
	}
	if got := p.Days[0].Blocks[1].Required; got != 1 {
		t.Errorf("required = %d, want an absent value to read as choose-one", got)
	}
}

func TestSwitchingAlternativeKeepsTheOtherOnesSets(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	sess, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	bench := sess.Snapshot.Blocks[0]

	// Two sets of bench press, then a change of mind, then back again. The
	// bench press sets have to survive the round trip — losing them was the
	// bug that made the swap destructive.
	_, err = s.SaveProgress(ctx, 1, sess.ID, Progress{Blocks: map[string]BlockProgress{
		bench.ID: {Picks: []int{0}, Sets: map[string][]SetLog{
			bench.Options[0].ID: {{Done: true}, {Done: true}},
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.SaveProgress(ctx, 1, sess.ID, Progress{Blocks: map[string]BlockProgress{
		bench.ID: {Picks: []int{1}, Sets: map[string][]SetLog{
			bench.Options[0].ID: {{Done: true}, {Done: true}},
			bench.Options[1].ID: {{Done: true}},
		}},
	}})
	if err != nil {
		t.Fatal(err)
	}

	stored, err := s.GetSession(ctx, 1, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if n := len(stored.Progress.Blocks[bench.ID].Sets[bench.Options[0].ID]); n != 2 {
		t.Errorf("the unpicked option kept %d sets, want the 2 it had", n)
	}
	// Only the picked one counts towards the totals, though.
	if got.DoneSets != 1 {
		t.Errorf("doneSets = %d, want only the picked option's set", got.DoneSets)
	}
}

func TestProgressFromTheFirstVersionStillReads(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	sess, err := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	bench := sess.Snapshot.Blocks[0]

	// The shape the first version wrote: a single pick and a flat set list.
	// A session already running when this shipped must not come back empty.
	var old Progress
	if err := json.Unmarshal([]byte(`{"blocks":{"`+bench.ID+`":{"pick":0,"sets":[{"done":true},{"done":true}]}}}`), &old); err != nil {
		t.Fatalf("decode legacy progress: %v", err)
	}
	sess.Progress = old
	done, _, _ := sess.Stats()
	if done != 2 {
		t.Errorf("doneSets from the old shape = %d, want 2", done)
	}
}

// --- exercises that are not lifts ----------------------------------------

func TestTimedAndBodyweightExercises(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p, err := s.CreatePlan(ctx, 1, PlanInput{Name: "Calisthenics"})
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.ReplaceDays(ctx, 1, p.ID, []Day{{
		Name: "Day",
		Blocks: []Block{
			{Options: []Exercise{{Name: "Pull-ups", Kind: KindBody, Sets: 3, Reps: "8"}}},
			{Options: []Exercise{{Name: "Weighted pull-ups", Kind: KindBody, Sets: 2, Reps: "5", WeightKg: 10}}},
			{Options: []Exercise{{Name: "Plank", Kind: KindTime, Sets: 3, DurationSec: 45}}},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	day := p.Days[0]
	if day.Blocks[0].Options[0].Kind != KindBody {
		t.Error("bodyweight kind did not round trip")
	}
	if got := day.Blocks[2].Options[0].DurationSec; got != 45 {
		t.Errorf("durationSec = %d, want 45", got)
	}

	sess, err := s.StartSession(ctx, 1, p.ID, day.ID)
	if err != nil {
		t.Fatal(err)
	}
	b := sess.Snapshot.Blocks
	got, err := s.SaveProgress(ctx, 1, sess.ID, Progress{Blocks: map[string]BlockProgress{
		b[0].ID: {Sets: map[string][]SetLog{b[0].Options[0].ID: {{Done: true}, {Done: true}, {Done: true}}}},
		b[1].ID: {Sets: map[string][]SetLog{b[1].Options[0].ID: {{Done: true}, {Done: true}}}},
		b[2].ID: {Sets: map[string][]SetLog{b[2].Options[0].ID: {{Done: true, DurationSec: 50}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}

	if got.DoneSets != 6 {
		t.Errorf("doneSets = %d, want 6", got.DoneSets)
	}
	// Only the added load counts: this package has no business guessing what
	// the user weighs, and a held position has no reps to multiply.
	if want := 10.0 * 5 * 2; got.VolumeKg != want {
		t.Errorf("volumeKg = %v, want %v — only the weighted pull-ups", got.VolumeKg, want)
	}
}

func TestSetTimestampsSurvive(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	p := samplePlan(t, s, 1)
	sess, _ := s.StartSession(ctx, 1, p.ID, p.Days[0].ID)
	bench := sess.Snapshot.Blocks[0]

	if _, err := s.SaveProgress(ctx, 1, sess.ID, Progress{Blocks: map[string]BlockProgress{
		bench.ID: {Sets: map[string][]SetLog{
			bench.Options[0].ID: {{Done: true, At: "2026-08-17T09:30:00Z", WeightKg: 62.5, Reps: "9"}},
		}},
	}}); err != nil {
		t.Fatal(err)
	}

	stored, err := s.GetSession(ctx, 1, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	set := stored.Progress.Blocks[bench.ID].Sets[bench.Options[0].ID][0]
	// History shows when each set happened and what it actually was; all
	// three have to come back out of the JSON blob.
	if set.At != "2026-08-17T09:30:00Z" || set.WeightKg != 62.5 || set.Reps != "9" {
		t.Errorf("set came back as %+v", set)
	}
}

// --- history and suggestions ---------------------------------------------

func TestDeleteSessionsClearsOnlyTheCallersRows(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	mine := samplePlan(t, s, 1)
	theirs := samplePlan(t, s, 2)

	var ids []string
	for range 3 {
		sess, err := s.StartSession(ctx, 1, mine.ID, mine.Days[0].ID)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.FinishSession(ctx, 1, sess.ID, "", ""); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, sess.ID)
	}
	other, err := s.StartSession(ctx, 2, theirs.ID, theirs.Days[0].ID)
	if err != nil {
		t.Fatal(err)
	}

	deleted, err := s.DeleteSessions(ctx, 1, append(ids, other.ID, "", ids[0]))
	if err != nil {
		t.Fatalf("DeleteSessions() error = %v", err)
	}
	if deleted != 3 {
		t.Errorf("deleted = %d, want 3 — not the other user's, and not the duplicate twice", deleted)
	}
	if _, err := s.GetSession(ctx, 2, other.ID); err != nil {
		t.Errorf("the other user's session went too: %v", err)
	}
}

// A session still running is not history. Deleting it from the history list
// would leave the runner ticking sets into something the server has forgotten,
// so the only ways out of a session are finishing and discarding it.
func TestDeleteSessionsLeavesTheRunningOneAlone(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	plan := samplePlan(t, s, 1)

	old, err := s.StartSession(ctx, 1, plan.ID, plan.Days[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.FinishSession(ctx, 1, old.ID, "", ""); err != nil {
		t.Fatal(err)
	}
	running, err := s.StartSession(ctx, 1, plan.ID, plan.Days[0].ID)
	if err != nil {
		t.Fatal(err)
	}

	deleted, err := s.DeleteSessions(ctx, 1, []string{old.ID, running.ID})
	if err != nil {
		t.Fatalf("DeleteSessions() error = %v", err)
	}
	if deleted != 1 {
		t.Errorf("deleted = %d, want 1 — the finished session only", deleted)
	}
	if _, err := s.GetSession(ctx, 1, running.ID); err != nil {
		t.Errorf("the running session was deleted: %v", err)
	}
}

func TestExerciseNamesComeFromThePlansThemselves(t *testing.T) {
	s, _ := newTestService(t)
	ctx := context.Background()
	samplePlan(t, s, 1)
	samplePlan(t, s, 2)

	names, err := s.ExerciseNames(ctx, 1)
	if err != nil {
		t.Fatalf("ExerciseNames() error = %v", err)
	}
	want := map[string]bool{"Bench press": true, "Push-ups": true, "Cable fly": true}
	if len(names) != len(want) {
		t.Fatalf("got %v, want the 3 names in the plan", names)
	}
	for _, n := range names {
		if !want[n] {
			t.Errorf("unexpected name %q — is another user's plan leaking in?", n)
		}
	}

	// A user with no plans has no suggestions, rather than everyone else's.
	empty, err := s.ExerciseNames(ctx, 99)
	if err != nil || len(empty) != 0 {
		t.Errorf("ExerciseNames() for a stranger = %v, %v", empty, err)
	}
}
