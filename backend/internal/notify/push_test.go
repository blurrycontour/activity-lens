package notify

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// browserKeys mints the keypair a browser hands over when it subscribes, so the
// encryption path runs for real rather than being stubbed out.
func browserKeys(t *testing.T) (p256dh, auth string) {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 16)
	if _, err := rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	b64 := base64.RawURLEncoding.EncodeToString
	return b64(key.PublicKey().Bytes()), b64(secret)
}

// vapidForTest generates a real keypair; push is silently disabled without one.
func vapidForTest(t *testing.T) VAPIDKeys {
	t.Helper()
	priv, pub, err := GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	return VAPIDKeys{Public: pub, Private: priv, Subject: "mailto:test@example.com"}
}

// Notifying a user with a registered device must actually put an encrypted,
// VAPID-signed request on the wire. Everything up to this point can look
// healthy while nothing is delivered, which is precisely the failure that
// shipped once already.
func TestNotifyDeliversPush(t *testing.T) {
	var hits int32
	var sawAuth, sawBody bool
	push := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&hits, 1)
		sawAuth = r.Header.Get("Authorization") != ""
		sawBody = r.ContentLength > 0
		w.WriteHeader(http.StatusCreated)
	}))
	defer push.Close()

	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo, vapidForTest(t), nil)
	ctx := context.Background()

	p256dh, auth := browserKeys(t)
	if err := svc.Subscribe(ctx, Subscription{
		Endpoint: push.URL + "/push/alice", UserID: alice, P256dh: p256dh, Auth: auth,
	}); err != nil {
		t.Fatalf("Subscribe() error = %v", err)
	}

	svc.Notify(ctx, Event{UserID: alice, Kind: KindWorkoutShared, Title: "Bob shared a workout"})

	if got := atomic.LoadInt32(&hits); got != 1 {
		t.Fatalf("push service received %d requests, want 1", got)
	}
	if !sawAuth {
		t.Error("push request carried no Authorization header; VAPID signing did not happen")
	}
	if !sawBody {
		t.Error("push request had an empty body; the payload was not encrypted in")
	}
}

// A browser drops subscriptions without telling us, and only says so by
// answering 410 to the next push. That is the sole opportunity to clean up, so
// missing it means pushing to a dead endpoint forever.
func TestExpiredSubscriptionIsRemoved(t *testing.T) {
	push := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusGone)
	}))
	defer push.Close()

	repo := NewSQLiteRepository(newTestDB(t))
	svc := NewService(repo, vapidForTest(t), nil)
	ctx := context.Background()

	p256dh, auth := browserKeys(t)
	if err := svc.Subscribe(ctx, Subscription{
		Endpoint: push.URL + "/gone", UserID: alice, P256dh: p256dh, Auth: auth,
	}); err != nil {
		t.Fatal(err)
	}

	svc.Notify(ctx, Event{UserID: alice, Kind: KindWorkoutShared, Title: "x"})

	subs, err := repo.Subscriptions(ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	if len(subs) != 0 {
		t.Fatalf("%d subscriptions remain after a 410; expired ones must be dropped", len(subs))
	}
}

// Push is optional. With no keypair the notification must still be stored and
// visible in-app, just never sent.
func TestNotifyWorksWithoutPushConfigured(t *testing.T) {
	svc := newTestService(t, DefaultPrefs())
	ctx := context.Background()

	svc.Notify(ctx, Event{UserID: alice, Kind: KindWorkoutShared, Title: "stored anyway"})

	list, err := svc.List(ctx, alice)
	if err != nil || len(list) != 1 {
		t.Fatalf("List() = %d rows, %v; want the notification stored", len(list), err)
	}
}
