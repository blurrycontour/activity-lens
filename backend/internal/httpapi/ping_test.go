package httpapi

import (
	"context"
	"testing"
	"time"
)

// The cooldown is the only thing standing between this feature and a way to
// vibrate someone's phone as fast as HTTP allows, so its edges are worth
// pinning: the first ping goes, the second does not, a different recipient is
// unaffected, and the wait expires.
func TestPingLimiter(t *testing.T) {
	p := newPingLimiter()
	const cd = time.Minute
	now := time.Date(2026, 8, 15, 9, 0, 0, 0, time.UTC)

	if _, ok := p.take(1, 2, cd, now); !ok {
		t.Fatal("the first ping was refused")
	}
	if left, ok := p.take(1, 2, cd, now.Add(30*time.Second)); ok || left != 30*time.Second {
		t.Errorf("second ping: allowed %v with %v left, want refused with 30s", ok, left)
	}
	// Per pair: being told to wait before nudging one person must not stop you
	// nudging another, which is the difference between a spam limit and a mute.
	if _, ok := p.take(1, 3, cd, now.Add(30*time.Second)); !ok {
		t.Error("a ping to a different person was refused")
	}
	// And it is directional — being pinged does not cost you your own turn.
	if _, ok := p.take(2, 1, cd, now.Add(30*time.Second)); !ok {
		t.Error("the recipient could not ping back")
	}
	if _, ok := p.take(1, 2, cd, now.Add(cd)); !ok {
		t.Error("the cooldown never expired")
	}
}

// wait is what the profile draws its countdown from, so it must agree with what
// take would actually do — and must not consume the turn itself.
func TestPingLimiterWaitDoesNotConsume(t *testing.T) {
	p := newPingLimiter()
	const cd = time.Minute
	now := time.Now()

	if left := p.wait(1, 2, cd, now); left != 0 {
		t.Errorf("a fresh pair reports %v left, want 0", left)
	}
	if _, ok := p.take(1, 2, cd, now); !ok {
		t.Fatal("asking about the wait consumed the ping")
	}
	if left := p.wait(1, 2, cd, now.Add(10*time.Second)); left != 50*time.Second {
		t.Errorf("wait = %v, want 50s", left)
	}
}

// The pruning sweep must never drop a pair that is still inside its cooldown —
// that would turn a full map into a way around the limit.
func TestPingLimiterPruneKeepsLiveEntries(t *testing.T) {
	p := newPingLimiter()
	const cd = time.Minute
	now := time.Now()

	// Fill past the sweep threshold with entries old enough to drop.
	for i := range int64(pingLimiterPrune) {
		p.take(i+100, 1, cd, now.Add(-2*cd))
	}
	p.take(1, 2, cd, now)
	// This take triggers the sweep, since the map is over the threshold.
	p.take(2, 3, cd, now)

	if _, ok := p.take(1, 2, cd, now.Add(time.Second)); ok {
		t.Error("a live cooldown was swept away, letting a second ping through")
	}
	if len(p.last) > pingLimiterPrune {
		t.Errorf("map still holds %d entries after a sweep", len(p.last))
	}
}

// Every id the client can send has to resolve, and nothing else may. The
// message being server-owned is what keeps a ping from carrying typed text to
// someone else's lock screen.
func TestPingMessages(t *testing.T) {
	for _, m := range pingMessages {
		if text, ok := pingText(m.ID); !ok || text != m.Text {
			t.Errorf("%q does not resolve to its own text", m.ID)
		}
		if m.Text == "" {
			t.Errorf("%q has no message", m.ID)
		}
	}
	for _, bad := range []string{"", "Run", "nonsense", "couch potato"} {
		if _, ok := pingText(bad); ok {
			t.Errorf("%q was accepted as a ping", bad)
		}
	}
	// The couch is the reason this is not just a list of activity types, and
	// dropping it in a refactor would leave a row of demands.
	if _, ok := pingText("couch"); !ok {
		t.Error("the couch potato is gone")
	}
}

// An image built without the Android app must announce nothing: there is no
// install for anyone to perform, and a server upgrade on its own is not news.
// It must also not read or write the recorded version on the way out — this
// Server has no settings store, so anything that touched it would panic here.
func TestNoAndroidAppAnnouncesNothing(t *testing.T) {
	(&Server{}).announceAppUpdate(context.Background())
}
