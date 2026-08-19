package workout

import (
	"context"
	"fmt"
	"strings"
)

// idChunk bounds how many ids go into one IN clause.
//
// SQLite's default parameter ceiling is 999, and a library runs to thousands of
// workouts. Chunking keeps one query per few hundred rows rather than one per
// row, which is the shape this exists to avoid.
const idChunk = 500

// RowFlags is what a list row can be filtered by that is not on the row itself.
//
// Counts rather than booleans, because the caller wants "has any" and a count
// answers that as well as leaving room for "how many" without a second query.
type RowFlags struct {
	Media    int
	Comments int
}

// FlagsFor counts the attachments and comments belonging to a set of workouts.
//
// By id rather than by owner: the same question is asked of your own library,
// of your profile, and of the two feeds, and only the first of those is a
// single owner's rows. Workouts with neither are simply absent from the map,
// which is what the caller reads as "no".
//
// Two queries, not two per row. The per-row form is the one that looks
// harmless in a handler and turns a library into a thousand round trips.
func (r *SQLiteRepository) FlagsFor(ctx context.Context, ids []string) (map[string]RowFlags, error) {
	out := make(map[string]RowFlags, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	for start := 0; start < len(ids); start += idChunk {
		chunk := ids[start:min(start+idChunk, len(ids))]
		if err := r.countInto(ctx, out, "workout_media", chunk, func(f *RowFlags, n int) { f.Media = n }); err != nil {
			return nil, err
		}
		if err := r.countInto(ctx, out, "comments", chunk, func(f *RowFlags, n int) { f.Comments = n }); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// countInto groups one table by workout and folds the counts into out.
//
// The table name is interpolated and the ids are bound, which is the only safe
// division: a table name cannot be a placeholder, and it is never anything but
// one of the two literals above.
//
// `comments` holds plans and sessions too, but their rows have a NULL
// workout_id and so cannot match an id in the IN list — the WHERE clause does
// the filtering that a separate table used to.
func (r *SQLiteRepository) countInto(
	ctx context.Context, out map[string]RowFlags, table string, ids []string, set func(*RowFlags, int),
) error {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	rows, err := r.db.QueryContext(ctx,
		`SELECT workout_id, COUNT(*) FROM `+table+
			` WHERE workout_id IN (`+placeholders+`) GROUP BY workout_id`, args...)
	if err != nil {
		return fmt.Errorf("count %s: %w", table, err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id string
			n  int
		)
		if err := rows.Scan(&id, &n); err != nil {
			return err
		}
		f := out[id]
		set(&f, n)
		out[id] = f
	}
	return rows.Err()
}
