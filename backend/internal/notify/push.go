package notify

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
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

	// VAPID keys are required for Web Push and irrelevant to UnifiedPush, so a
	// server without them still reaches phones. Checked per subscription rather
	// than up front, which is what used to make one missing key silence
	// everything.
	haveVAPID := s.keys.Public != "" && s.keys.Private != ""

	for _, sub := range subs {
		if sub.IsUnifiedPush() {
			s.sendUnifiedPush(ctx, sub, payload)
			continue
		}
		if haveVAPID {
			s.sendOne(ctx, sub, payload)
		}
	}
}

// sendUnifiedPush POSTs the payload to a distributor endpoint.
//
// No encryption and no VAPID: a UnifiedPush endpoint is a plain URL that accepts
// a body, and the distributor behind it is the user's own — ntfy on their
// server, typically — rather than a vendor's. What that does mean is that the
// distributor sees the notification text, so the payload carries a title and a
// line of body and nothing more; the full record stays in the app, reachable
// over the authenticated API.
//
// Gone endpoints are deleted, exactly as for Web Push: a distributor that has
// forgotten a registration answers 404 or 410, and nothing will ever arrive
// again.
func (s *Service) sendUnifiedPush(ctx context.Context, sub Subscription, payload []byte) {
	ctx, cancel := context.WithTimeout(ctx, pushTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(payload))
	if err != nil {
		slog.Warn("unifiedpush request", "user_id", sub.UserID, "error", err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	// Asks a distributor that speaks RFC 8030 to hold the message for a day if
	// the phone is offline, matching the Web Push TTL above. Ignored by the
	// ones that do not.
	req.Header.Set("TTL", strconv.Itoa(int(24*time.Hour/time.Second)))
	req.Header.Set("Urgency", "normal")

	resp, err := s.client.Do(req)
	if err != nil {
		slog.Warn("unifiedpush delivery failed", "user_id", sub.UserID, "error", err)
		return
	}
	defer resp.Body.Close()

	switch {
	case resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusGone:
		if err := s.repo.DeleteSubscription(context.WithoutCancel(ctx), sub.Endpoint); err != nil {
			slog.Warn("could not delete expired unifiedpush subscription", "error", err)
		}
		slog.Info("unifiedpush subscription expired", "user_id", sub.UserID)
	case resp.StatusCode >= 300:
		slog.Warn("unifiedpush rejected", "user_id", sub.UserID, "status", resp.StatusCode)
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
