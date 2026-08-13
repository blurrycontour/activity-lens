// Package notify owns in-app notifications and their delivery as Web Push
// messages. It is deliberately independent of the domains that produce
// notifications: callers describe an event, and this package decides whether
// the user wants it, stores it, and pushes it.
package notify

import (
	"encoding/json"
	"time"
)

// Kind identifies what happened. It drives the icon the client renders and the
// per-kind switch in the user's preferences.
type Kind string

// Supported notification kinds.
const (
	// KindWorkoutShared: someone shared a workout directly with you.
	KindWorkoutShared Kind = "workout_shared"
	// KindGearWorn: a piece of equipment reached its replace-at distance.
	KindGearWorn Kind = "gear_worn"
	// KindGoalMet: a training goal was completed for its period.
	KindGoalMet Kind = "goal_met"
	// KindGoalAtRisk: a goal's period is nearly over and it is still short.
	KindGoalAtRisk Kind = "goal_at_risk"
	// KindWorkoutImported: the Android app's folder watch found new files and
	// imported them. The one kind that reports something the user did not do
	// from this device, which is exactly why it is worth telling them about.
	KindWorkoutImported Kind = "workout_imported"
	// KindGoalNoneSet: a nudge to set a training goal, for someone who trains
	// but has none. The one kind that is not about something that happened —
	// which is why it is rate limited hard and stops entirely when the training
	// does. See checkNoGoals.
	KindGoalNoneSet Kind = "goal_none_set"
	// KindWorkoutSocial: someone commented on, or reacted to, a workout you
	// own or are part of the conversation on. One kind for both, because they
	// are one feature and nobody wants "reactions" and "comments" as separate
	// switches for a page they either follow or do not.
	KindWorkoutSocial Kind = "workout_social"
	// KindFeedback: someone filed feedback. Only ever sent to administrators —
	// it is the one kind that reports on the instance rather than on the
	// recipient's own training, which is why Settings hides its switch from
	// everyone else rather than offering a toggle that can never fire.
	KindFeedback Kind = "feedback"
	// KindBroadcast: a message an administrator sent to everyone on this
	// instance — a planned outage, a new feature, a request to re-import
	// something. It has a switch like every other kind and is on by default.
	//
	// Mutable on purpose. An unmutable channel is a thing people learn to
	// resent, and this is a handful of friends sharing a server rather than a
	// service with terms to serve; an admin who needs to reach someone who has
	// switched it off has their phone number.
	KindBroadcast Kind = "broadcast"
)

// AllKinds is every kind, in the order Settings lists them.
var AllKinds = []Kind{KindBroadcast, KindWorkoutShared, KindWorkoutSocial, KindGearWorn, KindGoalMet, KindGoalAtRisk, KindGoalNoneSet, KindWorkoutImported, KindFeedback}

// ValidKind reports whether k is a known kind.
func ValidKind(k Kind) bool {
	for _, v := range AllKinds {
		if v == k {
			return true
		}
	}
	return false
}

// Notification is one delivered message.
type Notification struct {
	ID     string `json:"id"`
	UserID int64  `json:"-"`
	Kind   Kind   `json:"kind"`
	Title  string `json:"title"`
	Body   string `json:"body,omitempty"`
	// Link is an in-app path to open when tapped, e.g. "/workouts/abc123".
	Link string `json:"link,omitempty"`
	// Icon is the avatar of whoever caused this, when a person did. Empty for
	// system-generated notifications, which fall back to a kind icon.
	Icon      string     `json:"icon,omitempty"`
	ReadAt    *time.Time `json:"readAt,omitempty"`
	CreatedAt time.Time  `json:"createdAt"`
}

// Event is a request to notify someone. It is what producers construct; whether
// it becomes a stored notification depends on the user's preferences and on
// DedupeKey not having fired already.
type Event struct {
	UserID int64
	Kind   Kind
	Title  string
	Body   string
	Link   string
	// Icon is the actor's avatar path; leave empty for system events.
	Icon string
	// DedupeKey collapses a standing condition to a single notification. A worn
	// shoe is re-evaluated after every workout, but the user should hear about
	// it once, so gear events key on the equipment id. Empty means always new.
	DedupeKey string
}

// Prefs holds a user's per-kind switches plus the master push toggle. The zero
// value is not the default — see DefaultPrefs, which opts everything in.
type Prefs struct {
	// Kinds maps a Kind to whether the user wants it. A missing entry means
	// enabled, so a newly added kind is on by default rather than silently off
	// for everyone who saved preferences before it existed.
	Kinds map[Kind]bool `json:"kinds"`
	// Push disables Web Push delivery without disabling in-app notifications.
	Push bool `json:"push"`
}

// DefaultPrefs is what a user gets before they touch Settings: everything on.
func DefaultPrefs() Prefs {
	kinds := make(map[Kind]bool, len(AllKinds))
	for _, k := range AllKinds {
		kinds[k] = true
	}
	return Prefs{Kinds: kinds, Push: true}
}

// Wants reports whether the user should receive this kind in-app.
func (p Prefs) Wants(k Kind) bool {
	if p.Kinds == nil {
		return true
	}
	enabled, ok := p.Kinds[k]
	return !ok || enabled
}

// Kinds of push endpoint. Both are "a URL this device can be reached at"; they
// differ only in how a request to that URL is formed.
const (
	// KindWebPush is a browser endpoint, addressed with RFC 8291 encryption and
	// a VAPID signature.
	KindWebPush = "webpush"
	// KindUnifiedPush is an endpoint handed out by a UnifiedPush distributor on
	// the user's phone — ntfy and similar. The payload is POSTed to it as-is:
	// there is no encryption layer and no VAPID, because the distributor is the
	// user's own infrastructure rather than a vendor's.
	KindUnifiedPush = "unifiedpush"
)

// Subscription is one device's push endpoint, browser or phone.
type Subscription struct {
	Endpoint string
	UserID   int64
	// Kind is KindWebPush or KindUnifiedPush; empty means Web Push, for rows
	// that predate the column.
	Kind string
	// P256dh and Auth are the Web Push encryption keys. Empty for UnifiedPush.
	P256dh    string
	Auth      string
	UserAgent string
	CreatedAt time.Time
}

// IsUnifiedPush reports whether this endpoint is addressed by a plain POST.
func (s Subscription) IsUnifiedPush() bool {
	return s.Kind == KindUnifiedPush
}

// DecodePrefs parses stored preference JSON, falling back to defaults when it
// is absent or unreadable. Corrupt preferences should not silence a user's
// notifications, so this never returns an error.
func DecodePrefs(raw []byte) Prefs {
	p := DefaultPrefs()
	if len(raw) == 0 {
		return p
	}
	var stored Prefs
	if err := json.Unmarshal(raw, &stored); err != nil {
		return p
	}
	if stored.Kinds != nil {
		p.Kinds = stored.Kinds
	}
	p.Push = stored.Push
	return p
}
