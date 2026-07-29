package httpapi

import (
	"errors"
	"net/http"

	"github.com/blurrycontour/activity-lens/backend/internal/notify"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// notificationsResponse pairs the list with the unread count so the bell badge
// and the panel stay consistent — deriving the count client-side would be wrong
// as soon as the list is truncated at the fetch limit.
type notificationsResponse struct {
	Notifications []notify.Notification `json:"notifications"`
	Unread        int                   `json:"unread"`
	/// PushKey is the VAPID public key, or "" when push is unavailable.
	PushKey string `json:"pushKey,omitempty"`
}

func (s *Server) handleListNotifications(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	list, err := s.notify.List(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load notifications")
		return
	}
	unread, err := s.notify.UnreadCount(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load notifications")
		return
	}
	writeJSON(w, http.StatusOK, notificationsResponse{
		Notifications: list, Unread: unread, PushKey: s.notify.PushPublicKey(),
	})
}

func (s *Server) handleMarkNotificationRead(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.notify.MarkRead(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeNotifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMarkAllNotificationsRead(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.notify.MarkAllRead(r.Context(), user.ID); err != nil {
		s.writeNotifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleDeleteNotification(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.notify.Delete(r.Context(), user.ID, r.PathValue("id")); err != nil {
		s.writeNotifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleClearNotifications(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	if err := s.notify.DeleteAll(r.Context(), user.ID); err != nil {
		s.writeNotifyError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pushSubscribeRequest mirrors the browser's PushSubscription JSON shape, so
// the client can forward what `pushManager.subscribe()` handed it.
type pushSubscribeRequest struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	// Declared but unused. The browser always includes expirationTime (almost
	// always null) and decodeJSON rejects unknown fields, so leaving it out
	// makes every subscription request a 400.
	ExpirationTime any `json:"expirationTime"`
}

func (s *Server) handlePushSubscribe(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req pushSubscribeRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
		writeError(w, http.StatusBadRequest, "incomplete push subscription")
		return
	}
	err := s.notify.Subscribe(r.Context(), notify.Subscription{
		Endpoint:  req.Endpoint,
		UserID:    user.ID,
		P256dh:    req.Keys.P256dh,
		Auth:      req.Keys.Auth,
		UserAgent: r.UserAgent(),
	})
	if errors.Is(err, notify.ErrPushUnavailable) {
		writeError(w, http.StatusServiceUnavailable, "push notifications are not configured on this server")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not save push subscription")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handlePushUnsubscribe(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Endpoint string `json:"endpoint"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.notify.Unsubscribe(r.Context(), req.Endpoint); err != nil {
		writeError(w, http.StatusInternalServerError, "could not remove push subscription")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) writeNotifyError(w http.ResponseWriter, err error) {
	if errors.Is(err, notify.ErrNotFound) {
		writeError(w, http.StatusNotFound, "notification not found")
		return
	}
	writeError(w, http.StatusInternalServerError, "internal error")
}
