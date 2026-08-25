package notify

import (
	"context"
	"log/slog"
	"net/http"
	"time"
)

// listLimit caps how many notifications the panel loads. The bell is a recent
// activity list, not an archive; older rows stay in the database but are never
// fetched.
const listLimit = 50

// PrefsLoader resolves a user's notification preferences. It is a function
// rather than a dependency on the settings package so notify stays free of the
// rest of the app — settings imports nothing from here either.
type PrefsLoader func(ctx context.Context, userID int64) (Prefs, error)

// Service applies the rules around notifications: whether the user wants one,
// storing it, and pushing it to their devices.
type Service struct {
	repo  Repository
	keys  VAPIDKeys
	prefs PrefsLoader
	// client sends UnifiedPush requests. A field rather than http.DefaultClient
	// so a test can point it at an httptest server, and so the timeout is this
	// package's to set rather than the process's.
	client *http.Client
}

// NewService builds a notification service. Passing empty VAPID keys disables
// push; everything else keeps working in-app.
func NewService(repo Repository, keys VAPIDKeys, prefs PrefsLoader) *Service {
	return &Service{repo: repo, keys: keys, prefs: prefs, client: &http.Client{}}
}

// PushPublicKey is the VAPID public key browsers need to subscribe, or "" when
// push is not configured.
func (s *Service) PushPublicKey() string { return s.keys.Public }

// Notify stores an event and pushes it, unless the user has switched this kind
// off or an identical DedupeKey has already fired.
//
// It never returns an error to the caller: notifying is a side effect of some
// other operation (a share, an import), and failing that operation because a
// notification could not be written would be the wrong trade. Failures are
// logged instead.
func (s *Service) Notify(ctx context.Context, e Event) {
	if e.UserID <= 0 || !ValidKind(e.Kind) {
		return
	}
	prefs, err := s.loadPrefs(ctx, e.UserID)
	if err != nil {
		slog.Warn("could not load notification prefs", "user_id", e.UserID, "error", err)
		// Fall through with defaults: silently dropping a notification because
		// preferences could not be read is worse than sending an unwanted one.
		prefs = DefaultPrefs()
	}
	if !prefs.Wants(e.Kind) {
		return
	}

	n := &Notification{
		UserID: e.UserID,
		Kind:   e.Kind,
		Title:  e.Title,
		Body:   e.Body,
		Link:   e.Link,
		Icon:   e.Icon,
	}
	created, err := s.repo.Create(ctx, n, e.DedupeKey)
	if err != nil {
		slog.Error("could not store notification", "user_id", e.UserID, "kind", e.Kind, "error", err)
		return
	}
	if !created {
		// A standing condition that has already been reported.
		return
	}
	slog.Info("notification", "user_id", e.UserID, "kind", e.Kind, "id", n.ID)

	// After the store, not before: if the write failed there is nothing newer
	// to replace what is already there, and clearing the list first would have
	// left the user with neither.
	if e.Supersedes {
		if n, err := s.repo.Supersede(ctx, e.UserID, e.Kind, n.ID); err != nil {
			slog.Warn("could not supersede older notifications", "user_id", e.UserID, "kind", e.Kind, "error", err)
		} else if n > 0 {
			slog.Info("superseded notifications", "user_id", e.UserID, "kind", e.Kind, "removed", n)
		}
	}

	if prefs.Push {
		s.push(ctx, n)
	}
}

// Resolved clears the dedupe marker for a condition that no longer holds, so it
// can notify again if it recurs (a replaced shoe, a new goal period).
func (s *Service) Resolved(ctx context.Context, userID int64, dedupeKey string) {
	if err := s.repo.ClearDedupe(ctx, userID, dedupeKey); err != nil {
		slog.Warn("could not clear notification dedupe", "user_id", userID, "error", err)
	}
}

/*
Crossed records the state of a standing condition and reports whether this is
the moment it became true.

The edge, not the level. "Your goal is complete" is news the moment it becomes
true and never again while it stays true, and the difference between those two
cannot be read off the condition itself -- only off what it was last time
anyone looked. That used to be inferred from whether a notification with a
matching dedupe key existed, which got it wrong twice over: the marker sat on a
row the user could delete, so emptying the notification list re-armed
everything; and a condition that was already true the first time it was ever
checked looked exactly like one that had just become true, so the first workout
recorded after a goal was already complete announced three of them at once.

A first sighting is therefore recorded and never announced. For anything scoped
to a period -- a goal's key carries the week or month -- that costs one silent
period and rights itself at the next one, which is the correct trade against
announcing something the dashboard has been showing for days.

False on any error: a database that will not answer is not a reason to send
somebody a notification that may be wrong.
*/
func (s *Service) Crossed(ctx context.Context, userID int64, key string, active bool) bool {
	crossed, err := s.repo.RecordCondition(ctx, userID, key, active)
	if err != nil {
		slog.Warn("could not record condition state", "user_id", userID, "key", key, "error", err)
		return false
	}
	return crossed
}

// List returns the user's recent notifications, newest first.
func (s *Service) List(ctx context.Context, userID int64) ([]Notification, error) {
	return s.repo.List(ctx, userID, listLimit)
}

// UnreadCount is what the bell badge shows.
func (s *Service) UnreadCount(ctx context.Context, userID int64) (int, error) {
	return s.repo.UnreadCount(ctx, userID)
}

// MarkRead marks one notification read.
func (s *Service) MarkRead(ctx context.Context, userID int64, id string) error {
	return s.repo.MarkRead(ctx, userID, id)
}

// MarkAllRead clears the badge.
func (s *Service) MarkAllRead(ctx context.Context, userID int64) error {
	return s.repo.MarkAllRead(ctx, userID)
}

// Delete removes one notification.
func (s *Service) Delete(ctx context.Context, userID int64, id string) error {
	return s.repo.Delete(ctx, userID, id)
}

// DeleteAll empties the user's list.
func (s *Service) DeleteAll(ctx context.Context, userID int64) error {
	return s.repo.DeleteAll(ctx, userID)
}

// Subscribe registers a device for push.
//
// The VAPID check applies to browsers only. A UnifiedPush endpoint is addressed
// with a plain POST and needs no keypair, so a server with push otherwise
// unconfigured can still reach phones — gating it on VAPID would have made the
// Android app silently unable to enrol.
func (s *Service) Subscribe(ctx context.Context, sub Subscription) error {
	if !sub.IsUnifiedPush() && s.keys.Public == "" {
		return ErrPushUnavailable
	}
	return s.repo.SaveSubscription(ctx, sub)
}

// Unsubscribe removes a device's registration.
func (s *Service) Unsubscribe(ctx context.Context, endpoint string) error {
	return s.repo.DeleteSubscription(ctx, endpoint)
}

/*
SubscriptionRetention is how long a push subscription survives without the
device behind it checking in.

Every client re-sends its subscription on launch, so this is generous: it is the
gap after which someone has not opened Activity Lens on that device at all. A
phone coming back from three months in a drawer re-subscribes on the first
launch and loses nothing but the notifications it was never going to see.

The alternative — waiting for delivery to fail — does not work here. A ntfy
publish to a topic with no subscribers succeeds, so a dead UnifiedPush endpoint
is indistinguishable from a live one at the point of sending, and the rows
accumulate for the life of the instance.
*/
const SubscriptionRetention = 90 * 24 * time.Hour

// PruneSubscriptions drops subscriptions no device has confirmed within
// SubscriptionRetention, returning how many were removed.
func (s *Service) PruneSubscriptions(ctx context.Context) (int64, error) {
	return s.repo.PruneSubscriptions(ctx, time.Now().Add(-SubscriptionRetention))
}

// PurgeUser removes every notification and push subscription for an account,
// called when it is deleted.
func (s *Service) PurgeUser(ctx context.Context, userID int64) error {
	return s.repo.DeleteUserData(ctx, userID)
}

func (s *Service) loadPrefs(ctx context.Context, userID int64) (Prefs, error) {
	if s.prefs == nil {
		return DefaultPrefs(), nil
	}
	return s.prefs(ctx, userID)
}
