package store

import (
	"context"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// The pool is wider than one connection now, which is only safe because
// _txlock=immediate makes every explicit transaction take the write lock up
// front. Without it, two transactions that read before they write deadlock:
// each holds a shared lock the other must wait out, and SQLite returns
// SQLITE_BUSY on the upgrade rather than waiting, so busy_timeout does not
// save it. Both this app's equipment linking and go-authkit's OIDC user
// resolution are that shape.
func TestConcurrentReadThenWriteTransactionsDoNotDeadlock(t *testing.T) {
	db, err := OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	defer func() { _ = db.Close() }()

	ctx := context.Background()
	if _, err := db.ExecContext(ctx, `CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO t (id, n) VALUES (1, 0)`); err != nil {
		t.Fatal(err)
	}

	const workers = 8
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Read, then write, inside one transaction — the hazardous shape.
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				errs <- err
				return
			}
			defer func() { _ = tx.Rollback() }()
			var n int
			if err := tx.QueryRowContext(ctx, `SELECT n FROM t WHERE id = 1`).Scan(&n); err != nil {
				errs <- err
				return
			}
			// Hold the transaction open after the read so the workers
			// genuinely overlap. Without this they mostly run one after the
			// other and the hazard never fires.
			time.Sleep(20 * time.Millisecond)
			if _, err := tx.ExecContext(ctx, `UPDATE t SET n = ? WHERE id = 1`, n+1); err != nil {
				errs <- err
				return
			}
			errs <- tx.Commit()
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent transaction failed: %v", err)
		}
	}

	// Serialised properly, so every increment landed rather than being lost.
	var n int
	if err := db.QueryRowContext(ctx, `SELECT n FROM t WHERE id = 1`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != workers {
		t.Errorf("n = %d after %d increments, want %d — an update was lost", n, workers, workers)
	}
}
