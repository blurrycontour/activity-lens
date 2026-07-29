package notify

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/store"
)

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.MigrateApp(context.Background(), db); err != nil {
		t.Fatalf("MigrateApp() error = %v", err)
	}
	return db
}

// newTestService builds a service with push disabled (no VAPID keys) and the
// given preferences, so tests exercise the rules without any network.
func newTestService(t *testing.T, prefs Prefs) *Service {
	t.Helper()
	return NewService(NewSQLiteRepository(newTestDB(t)), VAPIDKeys{},
		func(context.Context, int64) (Prefs, error) { return prefs, nil })
}

const alice int64 = 1

func TestNotifyStoresAndCounts(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, DefaultPrefs())

	svc.Notify(ctx, Event{UserID: alice, Kind: KindWorkoutShared, Title: "Bob shared a workout"})

	list, err := svc.List(ctx, alice)
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}
	if len(list) != 1 || list[0].Title != "Bob shared a workout" {
		t.Fatalf("got %d notifications, want the one we sent", len(list))
	}
	unread, err := svc.UnreadCount(ctx, alice)
	if err != nil || unread != 1 {
		t.Fatalf("UnreadCount() = %d, %v; want 1", unread, err)
	}

	if err := svc.MarkRead(ctx, alice, list[0].ID); err != nil {
		t.Fatalf("MarkRead() error = %v", err)
	}
	if unread, _ := svc.UnreadCount(ctx, alice); unread != 0 {
		t.Fatalf("UnreadCount() after read = %d, want 0", unread)
	}
}

// A standing condition (a worn shoe) is re-evaluated after every workout, so it
// must only ever produce one notification until it is resolved.
func TestDedupeKeyFiresOnce(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, DefaultPrefs())

	e := Event{UserID: alice, Kind: KindGearWorn, Title: "Shoes are due", DedupeKey: "gear:abc"}
	for range 3 {
		svc.Notify(ctx, e)
	}

	list, _ := svc.List(ctx, alice)
	if len(list) != 1 {
		t.Fatalf("got %d notifications, want 1 for a repeated condition", len(list))
	}

	// Once resolved (the shoe was replaced) the condition may notify again.
	svc.Resolved(ctx, alice, "gear:abc")
	svc.Notify(ctx, e)
	if list, _ = svc.List(ctx, alice); len(list) != 2 {
		t.Fatalf("got %d notifications, want 2 after the condition was resolved", len(list))
	}
}

// Events with no dedupe key are always distinct — two people sharing two
// workouts must produce two notifications.
func TestEventsWithoutDedupeKeyAlwaysStore(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, DefaultPrefs())

	for range 3 {
		svc.Notify(ctx, Event{UserID: alice, Kind: KindWorkoutShared, Title: "shared"})
	}
	if list, _ := svc.List(ctx, alice); len(list) != 3 {
		t.Fatalf("got %d notifications, want 3", len(list))
	}
}

func TestDisabledKindIsDropped(t *testing.T) {
	ctx := context.Background()
	prefs := DefaultPrefs()
	prefs.Kinds[KindGearWorn] = false
	svc := newTestService(t, prefs)

	svc.Notify(ctx, Event{UserID: alice, Kind: KindGearWorn, Title: "Shoes are due"})
	svc.Notify(ctx, Event{UserID: alice, Kind: KindWorkoutShared, Title: "shared"})

	list, _ := svc.List(ctx, alice)
	if len(list) != 1 || list[0].Kind != KindWorkoutShared {
		t.Fatalf("got %v, want only the enabled kind", list)
	}
}

// A kind added after a user last saved their preferences must default to on,
// not silently off.
func TestUnknownKindDefaultsToEnabled(t *testing.T) {
	p := Prefs{Kinds: map[Kind]bool{KindGearWorn: false}}
	if !p.Wants(KindWorkoutShared) {
		t.Fatal("a kind absent from stored prefs should default to enabled")
	}
	if p.Wants(KindGearWorn) {
		t.Fatal("an explicitly disabled kind should stay disabled")
	}
}

func TestDecodePrefsFallsBackOnGarbage(t *testing.T) {
	p := DecodePrefs([]byte("not json"))
	if !p.Wants(KindWorkoutShared) || !p.Push {
		t.Fatal("unreadable preferences should fall back to defaults, not silence notifications")
	}
}

func TestNotificationsAreScopedToTheirUser(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t, DefaultPrefs())

	svc.Notify(ctx, Event{UserID: alice, Kind: KindWorkoutShared, Title: "for alice"})
	list, _ := svc.List(ctx, alice)

	const bob int64 = 2
	if got, _ := svc.List(ctx, bob); len(got) != 0 {
		t.Fatalf("bob sees %d of alice's notifications", len(got))
	}
	if err := svc.MarkRead(ctx, bob, list[0].ID); err == nil {
		t.Fatal("bob should not be able to mark alice's notification read")
	}
	if err := svc.Delete(ctx, bob, list[0].ID); err == nil {
		t.Fatal("bob should not be able to delete alice's notification")
	}
}

func TestSubscriptionUpsertAndPurge(t *testing.T) {
	ctx := context.Background()
	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo, VAPIDKeys{Public: "pub", Private: "priv"}, nil)

	sub := Subscription{Endpoint: "https://push.example/abc", UserID: alice, P256dh: "k1", Auth: "a1"}
	if err := svc.Subscribe(ctx, sub); err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}
	// Re-subscribing the same browser updates its keys rather than duplicating.
	sub.P256dh = "k2"
	if err := svc.Subscribe(ctx, sub); err != nil {
		t.Fatalf("re-Subscribe() error = %v", err)
	}
	subs, _ := repo.Subscriptions(ctx, alice)
	if len(subs) != 1 || subs[0].P256dh != "k2" {
		t.Fatalf("got %v, want one subscription with refreshed keys", subs)
	}

	svc.Notify(ctx, Event{UserID: alice, Kind: KindWorkoutShared, Title: "x"})
	if err := svc.PurgeUser(ctx, alice); err != nil {
		t.Fatalf("PurgeUser() error = %v", err)
	}
	if list, _ := svc.List(ctx, alice); len(list) != 0 {
		t.Fatal("notifications survived account deletion")
	}
	if subs, _ := repo.Subscriptions(ctx, alice); len(subs) != 0 {
		t.Fatal("push subscriptions survived account deletion")
	}
}

// Push is optional: with no keypair the service must still store notifications
// and simply not attempt delivery.
func TestSubscribeRejectedWhenPushUnconfigured(t *testing.T) {
	svc := newTestService(t, DefaultPrefs())
	err := svc.Subscribe(context.Background(), Subscription{Endpoint: "e", UserID: alice, P256dh: "k", Auth: "a"})
	if err == nil {
		t.Fatal("Subscribe() should fail when no VAPID keypair is configured")
	}
	if svc.PushPublicKey() != "" {
		t.Fatal("PushPublicKey() should be empty when push is unconfigured")
	}
}
