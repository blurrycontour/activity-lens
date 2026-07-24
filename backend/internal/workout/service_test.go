package workout

import (
	"context"
	"testing"
	"time"
)

type fakeRepo struct {
	workouts map[string]*Workout
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{workouts: map[string]*Workout{}}
}

func (r *fakeRepo) Create(ctx context.Context, w *Workout) error {
	r.workouts[w.ID] = w
	return nil
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
