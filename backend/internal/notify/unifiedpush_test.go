package notify

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
)

// recordingRepo captures what the service does to subscriptions, which is the
// half of delivery that outlives a single request.
type recordingRepo struct {
	Repository
	mu      sync.Mutex
	subs    []Subscription
	deleted []string
}

func (r *recordingRepo) Subscriptions(context.Context, int64) ([]Subscription, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]Subscription(nil), r.subs...), nil
}

func (r *recordingRepo) SaveSubscription(_ context.Context, sub Subscription) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.subs = append(r.subs, sub)
	return nil
}

func (r *recordingRepo) DeleteSubscription(_ context.Context, endpoint string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deleted = append(r.deleted, endpoint)
	return nil
}

func testNotification() *Notification {
	return &Notification{ID: "n1", UserID: 7, Kind: KindGoalMet, Title: "Goal met", Body: "5 runs this week"}
}

// The whole point of the UnifiedPush path: a plain POST, with the notification
// in the body, to whatever URL the distributor handed out.
func TestUnifiedPushDelivery(t *testing.T) {
	var (
		mu     sync.Mutex
		gotCT  string
		gotTTL string
		body   []byte
		hits   int
	)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		hits++
		gotCT = r.Header.Get("Content-Type")
		gotTTL = r.Header.Get("TTL")
		body = make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	repo := &recordingRepo{subs: []Subscription{{Endpoint: server.URL, UserID: 7, Kind: KindUnifiedPush}}}
	// Deliberately no VAPID keys: a UnifiedPush endpoint needs none, and a
	// server without them must still reach phones.
	s := NewService(repo, VAPIDKeys{}, nil)

	s.push(context.Background(), testNotification())

	mu.Lock()
	defer mu.Unlock()
	if hits != 1 {
		t.Fatalf("distributor received %d requests, want 1", hits)
	}
	if gotCT != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", gotCT)
	}
	if gotTTL == "" {
		t.Error("no TTL header; an offline phone would miss the notification entirely")
	}
	var payload pushPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		t.Fatalf("body is not the notification payload: %v", err)
	}
	if payload.Title != "Goal met" || payload.ID != "n1" {
		t.Errorf("payload = %+v, want the notification's own fields", payload)
	}
}

// A distributor that has forgotten a registration says so once; keeping the row
// would mean retrying forever.
func TestUnifiedPushGoneEndpointIsDeleted(t *testing.T) {
	for _, status := range []int{http.StatusNotFound, http.StatusGone} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(status)
		}))
		repo := &recordingRepo{subs: []Subscription{{Endpoint: server.URL, UserID: 7, Kind: KindUnifiedPush}}}
		s := NewService(repo, VAPIDKeys{}, nil)

		s.push(context.Background(), testNotification())
		server.Close()

		repo.mu.Lock()
		deleted := len(repo.deleted)
		repo.mu.Unlock()
		if deleted != 1 {
			t.Errorf("status %d: deleted %d subscriptions, want 1", status, deleted)
		}
	}
}

// A distributor that is merely unhappy — rate limiting, a bad gateway — must not
// cost the user their registration.
func TestUnifiedPushTransientFailureKeepsSubscription(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	repo := &recordingRepo{subs: []Subscription{{Endpoint: server.URL, UserID: 7, Kind: KindUnifiedPush}}}
	s := NewService(repo, VAPIDKeys{}, nil)

	s.push(context.Background(), testNotification())

	repo.mu.Lock()
	defer repo.mu.Unlock()
	if len(repo.deleted) != 0 {
		t.Errorf("a 503 deleted the subscription; only 404/410 mean gone")
	}
}

// Without VAPID keys the Web Push half cannot send. It must skip those rows
// rather than abandoning the whole loop — which is what a single up-front check
// would have done, silently taking phones down with it.
func TestWebPushWithoutVAPIDDoesNotBlockUnifiedPush(t *testing.T) {
	var hits int
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		mu.Lock()
		hits++
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	repo := &recordingRepo{subs: []Subscription{
		{Endpoint: "https://fcm.example.com/browser-endpoint", UserID: 7, Kind: KindWebPush, P256dh: "x", Auth: "y"},
		{Endpoint: server.URL, UserID: 7, Kind: KindUnifiedPush},
	}}
	s := NewService(repo, VAPIDKeys{}, nil)

	s.push(context.Background(), testNotification())

	mu.Lock()
	defer mu.Unlock()
	if hits != 1 {
		t.Errorf("UnifiedPush endpoint got %d requests, want 1", hits)
	}
}

// Subscribing is the one place the two kinds are allowed to disagree about
// whether VAPID is required.
func TestSubscribeRequiresVAPIDForWebPushOnly(t *testing.T) {
	repo := &recordingRepo{}
	s := NewService(repo, VAPIDKeys{}, nil)

	err := s.Subscribe(context.Background(), Subscription{Endpoint: "https://x/y", Kind: KindWebPush, P256dh: "a", Auth: "b"})
	if err == nil {
		t.Error("web push subscription accepted without VAPID keys")
	}
	if err := s.Subscribe(context.Background(), Subscription{Endpoint: "https://x/y", Kind: KindUnifiedPush}); err != nil {
		t.Errorf("unifiedpush subscription rejected without VAPID keys: %v", err)
	}
}
