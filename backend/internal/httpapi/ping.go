package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/notify"
	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"
	"github.com/blurrycontour/go-authkit/httpmw"
)

/*
Pinging: one member nudging another from their profile.

The whole message is chosen from a fixed list rather than typed. That is the
security property this feature rests on — a ping is delivered to someone else's
phone as an OS notification wearing the sender's face, and free text there is a
way to put arbitrary words in front of a person who never opened the app. A
closed list makes the worst case "somebody suggested a swim too often", which
the cooldown then bounds.
*/

// pingMessage is one thing a person can say by tapping an icon.
type pingMessage struct {
	// ID is what the client sends. Stable, because it is stored in nothing but
	// is typed into requests by an older app for as long as that app exists.
	ID string `json:"id"`
	// Text is what the recipient reads. Written from the sender's side — this
	// is a person talking, not the app reporting.
	Text string `json:"text"`
}

/*
pingMessages is every ping, in the order the profile lays them out.

The five real activity types plus the couch. "Other" is deliberately not here:
it exists so an import with no declared sport has somewhere to land, and "let's
go and do an Other" is not a thing anyone means to say.

The couch earns its place by being the only one that is not a suggestion. Half
of what people actually send each other is "I am doing nothing today", and
without it the row is a row of demands.
*/
var pingMessages = []pingMessage{
	{ID: "run", Text: "Let's go for a run!"},
	{ID: "ride", Text: "Let's go for a ride!"},
	{ID: "hike", Text: "Let's go for a hike!"},
	{ID: "swim", Text: "Let's go for a swim!"},
	{ID: "strength", Text: "Let's hit the gym!"},
	{ID: "couch", Text: "Feeling like a couch potato."},
}

// pingText resolves a message id, reporting whether it is one we offer.
func pingText(id string) (string, bool) {
	for _, m := range pingMessages {
		if m.ID == id {
			return m.Text, true
		}
	}
	return "", false
}

/*
pingLimiter remembers when each sender last pinged each recipient.

In memory rather than in a table, because this is the one piece of state in the
app whose whole lifetime is shorter than a cooldown: the question it answers
("may this person send another one right now?") is only ever asked about the
last minute or so. A table would mean a migration, a write per ping and a row
per pair, to hold facts that are stale seconds after they are written.

What that costs is a restart clearing the timers. A restart is an administrator
action rather than something a sender can provoke, so the worst case is one
extra ping getting through after a deployment — which is not the failure this
feature exists to prevent.

Per (sender, recipient) rather than per sender: nudging two different friends in
the same minute is normal use, and the spam worth stopping is aimed at one
person.
*/
type pingLimiter struct {
	mu   sync.Mutex
	last map[[2]int64]time.Time
}

func newPingLimiter() *pingLimiter { return &pingLimiter{last: map[[2]int64]time.Time{}} }

// pingLimiterPrune is how many entries may accumulate before expired ones are
// swept. The sweep is O(n) and only runs when the map has grown, so an instance
// that pings occasionally never pays for it.
const pingLimiterPrune = 512

// wait returns how long is left of the cooldown between two people, or zero
// when a ping may be sent now.
func (p *pingLimiter) wait(from, to int64, cooldown time.Duration, now time.Time) time.Duration {
	p.mu.Lock()
	defer p.mu.Unlock()
	left := p.last[[2]int64{from, to}].Add(cooldown).Sub(now)
	if left <= 0 {
		return 0
	}
	return left
}

// take records a ping if the cooldown allows it, returning how long is left
// when it does not.
//
// Check and record under one lock: two requests arriving together would
// otherwise both read "ready" and both send, which is exactly the burst a
// cooldown is for.
func (p *pingLimiter) take(from, to int64, cooldown time.Duration, now time.Time) (time.Duration, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	key := [2]int64{from, to}
	if left := p.last[key].Add(cooldown).Sub(now); left > 0 {
		return left, false
	}
	if len(p.last) >= pingLimiterPrune {
		for k, at := range p.last {
			if now.Sub(at) > cooldown {
				delete(p.last, k)
			}
		}
	}
	p.last[key] = now
	return 0, true
}

// pingCooldown resolves the configured wait, falling back to the default rather
// than failing a ping over a settings read.
func (s *Server) pingCooldown(r *http.Request) time.Duration {
	secs := settings.DefaultPingCooldown
	if social, err := s.settings.StoredSocial(r.Context()); err == nil {
		secs = social.PingCooldownSeconds
	}
	return time.Duration(secs) * time.Second
}

// handlePingUser nudges another member.
//
// Anyone signed in may ping anyone else, which is the same reach the profile
// page itself has: every member can already open every other member's profile,
// and a ping carries no information beyond that it was sent. Inactive accounts
// are unreachable, because lookupUser only resolves active ones.
func (s *Server) handlePingUser(w http.ResponseWriter, r *http.Request) {
	sender := httpmw.UserFrom(r)
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}
	if id == sender.ID {
		writeError(w, http.StatusBadRequest, "you cannot ping yourself")
		return
	}
	var req struct {
		Message string `json:"message"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	text, ok := pingText(req.Message)
	if !ok {
		writeError(w, http.StatusBadRequest, "unknown ping")
		return
	}

	ref, err := s.lookupUser(r, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load users")
		return
	}
	if ref == nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	cooldown := s.pingCooldown(r)
	left, allowed := s.pings.take(sender.ID, id, cooldown, time.Now())
	if !allowed {
		secs := int(left.Round(time.Second) / time.Second)
		if secs < 1 {
			secs = 1
		}
		// Retry-After as well as the message: the header is what a client can
		// act on without parsing English, and the message is what a person
		// reads when it reaches them anyway.
		w.Header().Set("Retry-After", strconv.Itoa(secs))
		writeError(w, http.StatusTooManyRequests, fmt.Sprintf("you can ping %s again in %ds", refName(*ref), secs))
		return
	}

	// The sender's face and a link to the sender's profile: this notification
	// is a person, so both the icon and the tap should lead back to them.
	s.notify.Notify(r.Context(), notify.Event{
		UserID: id,
		Kind:   notify.KindPing,
		Title:  fmt.Sprintf("%s pinged you", actorName(*sender)),
		Body:   text,
		Link:   fmt.Sprintf("/users/%d", sender.ID),
		Icon:   effectiveAvatar(*sender),
		// No dedupe key: sending the same nudge twice an hour apart is two
		// nudges, and the cooldown is what stops it being twenty.
	})

	writeJSON(w, http.StatusOK, map[string]any{
		"sent":            true,
		"cooldownSeconds": int(cooldown / time.Second),
	})
}

// refName names a person the way actorName does, from the directory ref rather
// than from an auth.User.
func refName(ref workout.OwnerRef) string {
	if ref.DisplayName != "" {
		return ref.DisplayName
	}
	return ref.Username
}
