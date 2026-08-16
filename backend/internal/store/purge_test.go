package store

import (
	"context"
	"sort"
	"testing"
)

// Nothing in this schema has a foreign key to go-authkit's users table — it
// removes accounts with a bare DELETE, and an FK would abort it — so deleting a
// user cleans up nothing on its own. Every table keyed by a user id has to be
// purged explicitly by httpapi.purgeUserData, and a table added later without a
// matching purge is a storage leak that no test would otherwise notice: the
// rows are simply orphaned, and the application keeps working.
//
// This is the tripwire. It does not check that the purge works — the store,
// equipment, notify and settings packages each test their own delete — it
// checks that whoever adds the next user-scoped table is told about the purge
// while they are still writing the migration.
func TestEveryUserScopedTableHasAnOwnerForPurging(t *testing.T) {
	// Each entry names what removes the table's rows on account deletion.
	// Adding a table here without wiring the purge is the mistake this guards
	// against, so update purgeUserData first and this map second.
	purgedBy := map[string]string{
		"workouts":           "workout.Service.PurgeUserWorkouts",
		"workout_shares":     "workout.Service.PurgeUserShares (recipient rows; owner rows cascade from workouts)",
		"equipment":          "equipment.Service.PurgeUser",
		"notifications":      "notify.Service.PurgeUser",
		"feedback":           "feedback.Service.PurgeUser",
		"push_subscriptions": "notify.Service.PurgeUser",
		"user_prefs":         "settings.Store.PurgeUser",
		"user_last_login":    "settings.Store.PurgeUser",
		"workout_media":      "workout.Service.PurgeUserPhotos",
		"workout_comments":   "workout.Service.PurgeUserComments (rows on own workouts cascade from workouts)",
		"workout_reactions":  "workout.Service.PurgeUserReactions (rows on own workouts cascade from workouts)",
		"session_clients":    "sessions.Store.PurgeUser",
		"training_plans":     "plans.Service.PurgeUser (days, blocks and exercises cascade from the plan)",
		"plan_sessions":      "plans.Service.PurgeUser",
	}

	db := openTemp(t)
	ctx := context.Background()
	if err := MigrateApp(ctx, db); err != nil {
		t.Fatalf("MigrateApp() error = %v", err)
	}

	rows, err := db.QueryContext(ctx, `
		SELECT m.name
		  FROM sqlite_master m
		  JOIN pragma_table_info(m.name) c
		 WHERE m.type = 'table' AND c.name = 'user_id'
		 ORDER BY m.name`)
	if err != nil {
		t.Fatalf("query user-scoped tables: %v", err)
	}
	defer rows.Close()

	found := make([]string, 0, len(purgedBy))
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatal(err)
		}
		found = append(found, name)
		if _, ok := purgedBy[name]; !ok {
			t.Errorf("table %q is keyed by user_id but nothing purges it on account deletion.\n"+
				"Add the delete to httpapi.purgeUserData, then list it in this test.", name)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	// The reverse direction: a table that was dropped or renamed leaves a stale
	// entry claiming to be purged, and a purge statement targeting a table that
	// no longer exists would fail at runtime, not here.
	for name := range purgedBy {
		if !contains(found, name) {
			t.Errorf("this test claims %q is purged, but no such user-scoped table exists", name)
		}
	}

	sort.Strings(found)
	t.Logf("user-scoped tables: %v", found)
}

func contains(haystack []string, needle string) bool {
	for _, s := range haystack {
		if s == needle {
			return true
		}
	}
	return false
}
