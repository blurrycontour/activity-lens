package workout

import (
	"context"
	"testing"
	"time"
)

// The notification says "3 workouts imported" and links to those three. This is
// what turns the count into a time window, and it is derived here rather than
// reported by the phone precisely because the phone got it wrong twice: once
// from a clock that disagreed with the server's, and once from an older build
// that did not send it at all. Both failed silently.
func TestImportWindow(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo)
	ctx := context.Background()

	// Four auto-imports and one upload, created in order. created_at comes from
	// the clock at insert, so a brief pause is what makes the order observable.
	var autoIDs []string
	for i, name := range []string{"auto one", "auto two", "auto three", "auto four"} {
		in := importInput(name, "hash-auto-"+name)
		in.ContentHash = "hash-auto-" + name
		in.Source = SourceAutoImport
		w, _, err := svc.CreateIdempotent(ctx, 1, in)
		if err != nil {
			t.Fatalf("import %d: %v", i, err)
		}
		autoIDs = append(autoIDs, w.ID)
		time.Sleep(1100 * time.Millisecond)
	}
	manual := importInput("uploaded by hand", "hash-upload")
	manual.ContentHash = "hash-upload"
	manual.Source = SourceUpload
	if _, _, err := svc.CreateIdempotent(ctx, 1, manual); err != nil {
		t.Fatalf("upload: %v", err)
	}

	// A batch of 2 spans the newest two auto-imports and nothing else.
	since, until, err := repo.ImportWindow(ctx, 1, SourceAutoImport, 2)
	if err != nil {
		t.Fatalf("ImportWindow: %v", err)
	}
	if since.IsZero() || until.IsZero() {
		t.Fatal("no window for a batch of 2, so the notification would link to everything")
	}

	inWindow := func() []string {
		list, err := repo.ListSummary(ctx, 1)
		if err != nil {
			t.Fatalf("ListSummary: %v", err)
		}
		var names []string
		for _, w := range list {
			if w.Source == SourceAutoImport && !w.CreatedAt.Before(since) && !w.CreatedAt.After(until) {
				names = append(names, w.Name)
			}
		}
		return names
	}
	if got := inWindow(); len(got) != 2 {
		t.Errorf("window covers %d workouts (%v), want the newest 2", len(got), got)
	}

	// The point of the closed upper bound: a notification is read later, by which
	// time the folder watch has run again. Its window must not have grown.
	time.Sleep(1100 * time.Millisecond)
	later := importInput("imported afterwards", "hash-auto-later")
	later.ContentHash = "hash-auto-later"
	later.Source = SourceAutoImport
	if _, _, err := svc.CreateIdempotent(ctx, 1, later); err != nil {
		t.Fatalf("later import: %v", err)
	}
	if got := inWindow(); len(got) != 2 {
		t.Errorf("after a later scan the window covers %d workouts (%v), want the same 2", len(got), got)
	}

	// The upload is newer than every auto-import and must not shift the window:
	// a batch is counted within its own source.
	if len(autoIDs) != 4 {
		t.Fatalf("setup: %d auto imports", len(autoIDs))
	}
	all, _, err := repo.ImportWindow(ctx, 1, SourceAutoImport, 4)
	if err != nil {
		t.Fatalf("ImportWindow(4): %v", err)
	}
	if !all.Before(since) {
		t.Error("a batch of 4 must reach further back than a batch of 2")
	}
}

// Asking for more than exist is not an error: it happens whenever a workout from
// the batch has since been deleted. "No window" means the link falls back to
// every auto-import, which is imprecise but still useful — unlike a window that
// matches nothing.
func TestImportWindowWithTooFewWorkouts(t *testing.T) {
	repo := NewSQLiteRepository(newTestDB(t))
	ctx := context.Background()

	for _, n := range []int{0, 1, 5} {
		since, until, err := repo.ImportWindow(ctx, 1, SourceAutoImport, n)
		if err != nil {
			t.Fatalf("ImportWindow(%d): %v", n, err)
		}
		if !since.IsZero() || !until.IsZero() {
			t.Errorf("ImportWindow(%d) = (%v, %v), want zero times", n, since, until)
		}
	}
}
