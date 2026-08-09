package workout

import (
	"context"
	"testing"
	"time"
)

type fakeRepo struct {
	workouts map[string]*Workout
	// The sharing half of Repository is a SQL authorization predicate; an
	// in-memory reimplementation would only test itself. Those methods are
	// exercised against the real migrated schema in sharing_test.go, so the
	// fake embeds a stub that fails loudly if a test reaches for one.
	unimplementedSharing
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{workouts: map[string]*Workout{}}
}

func (r *fakeRepo) Create(ctx context.Context, w *Workout) error {
	// Mirror the partial unique index on (user_id, source, external_id) so the
	// fake rejects duplicates the same way the real repository does.
	if w.ExternalID != "" {
		if _, err := r.GetByExternalID(ctx, w.UserID, w.Source, w.ExternalID); err == nil {
			return ErrDuplicate
		}
	}
	r.workouts[w.ID] = w
	return nil
}

func (r *fakeRepo) GetByExternalID(ctx context.Context, userID int64, source Source, externalID string) (*Workout, error) {
	for _, w := range r.workouts {
		if w.UserID == userID && w.Source == source && w.ExternalID == externalID {
			cp := *w
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (r *fakeRepo) Get(ctx context.Context, userID int64, id string) (*Workout, error) {
	w, ok := r.workouts[id]
	if !ok || w.UserID != userID {
		return nil, ErrNotFound
	}
	cp := *w
	return &cp, nil
}

func (r *fakeRepo) List(ctx context.Context, userID int64) ([]Workout, error) {
	var out []Workout
	for _, w := range r.workouts {
		if w.UserID == userID {
			out = append(out, *w)
		}
	}
	return out, nil
}

func (r *fakeRepo) ListSummary(ctx context.Context, userID int64) ([]Workout, error) {
	list, err := r.List(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range list {
		list[i].Route = nil
		list[i].HRTimeline = nil
		list[i].PaceTimeline = nil
		list[i].ElevTimeline = nil
	}
	return list, nil
}

func (r *fakeRepo) Update(ctx context.Context, w *Workout) error {
	if _, ok := r.workouts[w.ID]; !ok {
		return ErrNotFound
	}
	cp := *w
	r.workouts[w.ID] = &cp
	return nil
}

func (r *fakeRepo) Delete(ctx context.Context, userID int64, id string) error {
	w, ok := r.workouts[id]
	if !ok || w.UserID != userID {
		return ErrNotFound
	}
	delete(r.workouts, id)
	return nil
}

func TestUpdateAppliesStartTimeAndRecomputesDate(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)

	created, err := svc.Create(context.Background(), 1, Input{
		Name:      "Morning Run",
		Type:      TypeRun,
		StartTime: time.Date(2024, 1, 1, 8, 0, 0, 0, time.UTC),
		Duration:  1800,
		Distance:  5000,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if created.Date != "2024-01-01" {
		t.Fatalf("Date = %q, want 2024-01-01", created.Date)
	}

	newStart := time.Date(2024, 3, 15, 0, 0, 0, 0, time.UTC)
	newName := "Evening Run"
	updated, err := svc.Update(context.Background(), 1, created.ID, Patch{
		Name:      &newName,
		StartTime: &newStart,
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}
	if updated.Name != "Evening Run" {
		t.Fatalf("Name = %q, want Evening Run", updated.Name)
	}
	if updated.Date != "2024-03-15" {
		t.Fatalf("Date = %q, want 2024-03-15", updated.Date)
	}
	if !updated.StartTime.Equal(newStart) {
		t.Fatalf("StartTime = %v, want %v", updated.StartTime, newStart)
	}

	fetched, err := svc.Get(context.Background(), 1, created.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	if !fetched.StartTime.Equal(newStart) {
		t.Fatalf("persisted StartTime = %v, want %v", fetched.StartTime, newStart)
	}
}

// importInput is a workout as an upload would produce it: identified by the
// SHA-256 of the file bytes.
func importInput(name, hash string) Input {
	return Input{
		Name:       name,
		Type:       TypeRun,
		StartTime:  time.Date(2024, 5, 4, 7, 0, 0, 0, time.UTC),
		Duration:   1800,
		Distance:   5000,
		Source:     SourceUpload,
		ExternalID: hash,
	}
}

func TestCreateIdempotentSkipsAlreadyImportedFile(t *testing.T) {
	svc := NewService(newFakeRepo())
	ctx := context.Background()

	first, created, err := svc.CreateIdempotent(ctx, 1, importInput("Morning Run", "abc123"))
	if err != nil {
		t.Fatalf("first CreateIdempotent() error = %v", err)
	}
	if !created {
		t.Fatal("first import should have created a workout")
	}

	// Same bytes, different name override: resolves to the stored workout.
	second, created, err := svc.CreateIdempotent(ctx, 1, importInput("Renamed Run", "abc123"))
	if err != nil {
		t.Fatalf("second CreateIdempotent() error = %v", err)
	}
	if created {
		t.Fatal("re-importing the same file should not create a second workout")
	}
	if second.ID != first.ID {
		t.Fatalf("ID = %q, want the existing %q", second.ID, first.ID)
	}
	if second.Name != "Morning Run" {
		t.Fatalf("Name = %q, want the stored %q left untouched", second.Name, "Morning Run")
	}

	list, err := svc.List(ctx, 1)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("got %d workouts, want 1", len(list))
	}
}

func TestCreateIdempotentScopesDedupeToUserAndSource(t *testing.T) {
	svc := NewService(newFakeRepo())
	ctx := context.Background()

	if _, created, err := svc.CreateIdempotent(ctx, 1, importInput("Run", "abc123")); err != nil || !created {
		t.Fatalf("seed import: created = %v, err = %v", created, err)
	}

	// The same file uploaded by a different user is a different workout.
	if _, created, err := svc.CreateIdempotent(ctx, 2, importInput("Run", "abc123")); err != nil || !created {
		t.Fatalf("other user: created = %v, err = %v", created, err)
	}

	// The same id claimed by a different source is a different workout.
	hcIn := importInput("Run", "abc123")
	hcIn.Source = SourceHealthConnect
	if _, created, err := svc.CreateIdempotent(ctx, 1, hcIn); err != nil || !created {
		t.Fatalf("other source: created = %v, err = %v", created, err)
	}
}

func TestCreateIdempotentAlwaysInsertsWithoutExternalID(t *testing.T) {
	svc := NewService(newFakeRepo())
	ctx := context.Background()

	// Hand-entered workouts carry no external id, so two identical ones are
	// two genuine workouts (someone really did run the same loop twice).
	in := Input{Name: "Run", Type: TypeRun, StartTime: time.Now(), Duration: 1800, Distance: 5000}
	for i := 0; i < 2; i++ {
		if _, created, err := svc.CreateIdempotent(ctx, 1, in); err != nil || !created {
			t.Fatalf("insert %d: created = %v, err = %v", i, created, err)
		}
	}
	list, err := svc.List(ctx, 1)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(list) != 2 {
		t.Fatalf("got %d workouts, want 2", len(list))
	}
	if list[0].Source != SourceManual {
		t.Fatalf("Source = %q, want %q", list[0].Source, SourceManual)
	}
}

func TestUpdateRejectsEmptyName(t *testing.T) {
	repo := newFakeRepo()
	svc := NewService(repo)

	created, err := svc.Create(context.Background(), 1, Input{
		Name:      "Run",
		Type:      TypeRun,
		StartTime: time.Now(),
		Duration:  1800,
		Distance:  5000,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	empty := "   "
	if _, err := svc.Update(context.Background(), 1, created.ID, Patch{Name: &empty}); err == nil {
		t.Fatal("expected error for empty name patch")
	}
}

// An unclassified import used to get neither a pace nor a step count, because
// both were gated on a list of types written before TypeOther existed. Pace is
// arithmetic and was simply missing; the steps are an estimate, and treating an
// unnamed activity as walked is the deliberate choice recorded on onFoot.
func TestOtherIsTreatedAsAFootActivity(t *testing.T) {
	for _, tc := range []struct {
		typ       Type
		wantPace  bool
		wantSteps int
	}{
		{TypeRun, true, 5000},
		{TypeHike, true, 6667},
		{TypeOther, true, 6667},
		{TypeRide, false, 0},
		{TypeSwim, false, 0},
		{TypeStrength, false, 0},
	} {
		w := &Workout{Type: tc.typ, Distance: 5000, Duration: 1800}
		deriveMetrics(w, 0)
		if got := w.AvgPace > 0; got != tc.wantPace {
			t.Errorf("%s: pace present = %v, want %v", tc.typ, got, tc.wantPace)
		}
		if w.Steps != tc.wantSteps {
			t.Errorf("%s: steps = %d, want %d", tc.typ, w.Steps, tc.wantSteps)
		}
		// Speed is reported for everything that moved, and always was.
		if w.AvgSpeed <= 0 {
			t.Errorf("%s: speed = %v, want a positive figure", tc.typ, w.AvgSpeed)
		}
	}
}
