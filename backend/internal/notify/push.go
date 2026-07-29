package notify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// VAPIDKeys identifies this server to the browser push services. The keypair is
// generated once and stored, so it survives restarts — regenerating it would
// invalidate every existing subscription.
type VAPIDKeys struct {
	Public  string
	Private string
	// Subject is a mailto: or https: URL identifying the sender, required by
	// the Web Push spec so a push service has someone to contact about abuse.
	Subject string
}

// pushPayload is the JSON the service worker receives.
type pushPayload struct {
	ID    string `json:"id"`
	Kind  Kind   `json:"kind"`
	Title string `json:"title"`
	Body  string `json:"body,omitempty"`
	Link  string `json:"link,omitempty"`
	Icon  string `json:"icon,omitempty"`
}

// pushTimeout bounds one delivery attempt. Push services are third parties and
// a slow one must not hold up the request that triggered the notification.
const pushTimeout = 10 * time.Second

// push delivers n to every device the user has registered. Failures are logged
// rather than returned: a notification is already stored and visible in-app, so
// a dead browser endpoint is not a reason to fail the caller's operation.
//
// Endpoints rejected as gone (404/410) are deleted, which is the only way stale
// subscriptions are ever cleaned up — browsers do not tell us when they lapse.
func (s *Service) push(ctx context.Context, n *Notification) {
	if s.keys.Public == "" || s.keys.Private == "" {
		return
	}
	subs, err := s.repo.Subscriptions(ctx, n.UserID)
	if err != nil {
		slog.Warn("could not load push subscriptions", "user_id", n.UserID, "error", err)
		return
	}
	if len(subs) == 0 {
		return
	}
	payload, err := json.Marshal(pushPayload{
		ID: n.ID, Kind: n.Kind, Title: n.Title, Body: n.Body, Link: n.Link, Icon: n.Icon,
	})
	if err != nil {
		slog.Error("marshal push payload", "error", err)
		return
	}

	for _, sub := range subs {
		s.sendOne(ctx, sub, payload)
	}
}

func (s *Service) sendOne(ctx context.Context, sub Subscription, payload []byte) {
	ctx, cancel := context.WithTimeout(ctx, pushTimeout)
	defer cancel()

	resp, err := webpush.SendNotificationWithContext(ctx, payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys:     webpush.Keys{P256dh: sub.P256dh, Auth: sub.Auth},
	}, &webpush.Options{
		Subscriber:      s.keys.Subject,
		VAPIDPublicKey:  s.keys.Public,
		VAPIDPrivateKey: s.keys.Private,
		TTL:             int(24 * time.Hour / time.Second),
		Urgency:         webpush.UrgencyNormal,
	})
	if err != nil {
		slog.Warn("push delivery failed", "user_id", sub.UserID, "error", err)
		return
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		// The browser dropped this subscription; nothing will ever arrive again.
		if err := s.repo.DeleteSubscription(context.WithoutCancel(ctx), sub.Endpoint); err != nil {
			slog.Warn("could not delete expired push subscription", "error", err)
		}
		slog.Info("push subscription expired", "user_id", sub.UserID)
	case resp.StatusCode >= 300:
		slog.Warn("push rejected", "user_id", sub.UserID, "status", resp.StatusCode)
	}
}

// GenerateVAPIDKeys creates a fresh keypair, for first run.
func GenerateVAPIDKeys() (private, public string, err error) {
	private, public, err = webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", fmt.Errorf("generate VAPID keys: %w", err)
	}
	return private, public, nil
}

// ErrPushUnavailable is returned when push is requested but no keypair is set.
var ErrPushUnavailable = errors.New("notify: push is not configured")
