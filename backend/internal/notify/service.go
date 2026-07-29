package notify

import (
	"context"
	"log/slog"
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
}

// NewService builds a notification service. Passing empty VAPID keys disables
// push; everything else keeps working in-app.
func NewService(repo Repository, keys VAPIDKeys, prefs PrefsLoader) *Service {
	return &Service{repo: repo, keys: keys, prefs: prefs}
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

// Subscribe registers a browser for push.
func (s *Service) Subscribe(ctx context.Context, sub Subscription) error {
	if s.keys.Public == "" {
		return ErrPushUnavailable
	}
	return s.repo.SaveSubscription(ctx, sub)
}

// Unsubscribe removes a browser's registration.
func (s *Service) Unsubscribe(ctx context.Context, endpoint string) error {
	return s.repo.DeleteSubscription(ctx, endpoint)
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
