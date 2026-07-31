package httpapi

import (
	"crypto/sha256"
	"encoding/base64"
	"testing"
	"time"

	"github.com/blurrycontour/go-authkit/auth"
)

func challengeFor(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// The redirect target comes from the client, so it is the one place this flow
// could be turned into an open redirect — aiming a completed sign-in, code and
// all, at somewhere else entirely.
func TestAppSchemePattern(t *testing.T) {
	allowed := []string{
		"io.blurrycontour.activitylens",     // the published app
		"io.blurrycontour.activitylens.dev", // a local build, installed alongside
	}
	for _, s := range allowed {
		if !appSchemePattern.MatchString(s) {
			t.Errorf("scheme %q should be allowed", s)
		}
	}

	denied := []string{
		"",
		"https",                                  // would redirect to a URL of their choosing
		"io.blurrycontour.activitylens.evil.app", // only one suffix segment
		"io.blurrycontour.activitylensevil",      // no separator
		"evil.io.blurrycontour.activitylens",     // prefix
		"io.blurrycontour.activitylens.DEV",      // schemes are matched literally
		"io.blurrycontour.activitylens.a/../b",
		"io.blurrycontour.activitylens://evil.com",
	}
	for _, s := range denied {
		if appSchemePattern.MatchString(s) {
			t.Errorf("scheme %q must not be allowed", s)
		}
	}
}

// The verifier is what makes intercepting the deep link useless, so the code
// must be worthless without it.
func TestNativeAuthCodeRequiresItsVerifier(t *testing.T) {
	codes := newNativeAuthCodes()
	entry := nativeAuthCode{
		sessionID: "session-1",
		expiresAt: time.Now().Add(time.Hour),
		user:      &auth.User{ID: 1, Username: "sam"},
		challenge: challengeFor("the-real-verifier"),
		issued:    time.Now(),
	}
	codes.issue("code-1", entry)

	got, ok := codes.take("code-1")
	if !ok {
		t.Fatal("a freshly issued code should be redeemable")
	}
	if got.challenge != challengeFor("the-real-verifier") {
		t.Error("the challenge did not survive the round trip")
	}
	if got.challenge == challengeFor("a-guess") {
		t.Error("a different verifier must not produce the same challenge")
	}
}

// A code that has been presented once is spent, whether or not the verifier
// that came with it was right. Otherwise an intercepted code could be retried
// against one guess after another.
func TestNativeAuthCodeIsSingleUse(t *testing.T) {
	codes := newNativeAuthCodes()
	codes.issue("code-1", nativeAuthCode{challenge: challengeFor("v"), issued: time.Now()})

	if _, ok := codes.take("code-1"); !ok {
		t.Fatal("the first redemption should succeed")
	}
	if _, ok := codes.take("code-1"); ok {
		t.Error("the code was redeemable twice")
	}
}

func TestNativeAuthCodeExpires(t *testing.T) {
	codes := newNativeAuthCodes()
	codes.issue("stale", nativeAuthCode{
		challenge: challengeFor("v"),
		issued:    time.Now().Add(-nativeCodeTTL - time.Second),
	})
	if _, ok := codes.take("stale"); ok {
		t.Error("an expired code must not be redeemable")
	}
	if _, ok := codes.take("never-issued"); ok {
		t.Error("an unknown code must not be redeemable")
	}
}

// Issuing sweeps expired entries, so a long-running server does not accumulate
// them. Codes are only created by a sign-in, which is exactly when to prune.
func TestNativeAuthCodesArePruned(t *testing.T) {
	codes := newNativeAuthCodes()
	for _, id := range []string{"old-1", "old-2"} {
		codes.issue(id, nativeAuthCode{issued: time.Now().Add(-nativeCodeTTL - time.Second)})
	}
	codes.issue("fresh", nativeAuthCode{issued: time.Now()})

	if len(codes.m) != 1 {
		t.Errorf("map holds %d entries, want only the fresh one", len(codes.m))
	}
}

// The challenge is a base64url SHA-256 digest and nothing else. It is echoed
// into a Set-Cookie value, so anything that could carry a control character or
// a cookie separator has to be refused before it gets there.
func TestChallengePattern(t *testing.T) {
	if !challengePattern.MatchString(challengeFor("anything")) {
		t.Error("a real challenge should be accepted")
	}
	denied := []string{
		"",
		"short",
		challengeFor("x") + "=",      // padded
		challengeFor("x") + "a",      // too long
		challengeFor("x")[:42] + " ", // a space would split the cookie value
		challengeFor("x")[:42] + ";",
	}
	for _, c := range denied {
		if challengePattern.MatchString(c) {
			t.Errorf("challenge %q must not be accepted", c)
		}
	}
}
