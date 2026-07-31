package httpapi

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/blurrycontour/go-authkit/auth"
)

// SSO for the Android app.
//
// The web flow ends by setting a session cookie and redirecting to "/". None of
// that reaches the app: its WebView is on its own origin, cookies cannot cross
// that boundary, and CORS here deliberately never sends Allow-Credentials. So
// the native flow has to end by handing the app a *token* instead, and the only
// channel back into an app from a browser is a deep link.
//
// Putting the token straight in that deep link would be the short version and is
// not safe: Android grants no exclusivity over a custom scheme, so any installed
// app can register the same one and receive whatever the browser sends. What is
// sent instead is a single-use code that is worthless on its own — redeeming it
// requires the random verifier the app generated and never transmitted, which an
// interceptor does not have. This is the shape RFC 8252 prescribes for native
// apps, and PKCE's, for the same reason.
//
// The identity provider needs no reconfiguration: its redirect URI still points
// at this server's /api/auth/oidc/callback. Only the last hop changes.

const (
	// Carries the flow's parameters from Login to the callback. Both happen in
	// the same browser, so a cookie round-trips them without go-authkit having
	// to know this feature exists.
	nativeFlowCookie = "al_native_oidc"

	// How long the browser has to complete the whole OIDC round trip.
	nativeFlowTTL = 10 * time.Minute

	// How long the app has to redeem the code once the deep link fires. It is
	// the gap between two steps of one automated handoff, so this is generous.
	nativeCodeTTL = 2 * time.Minute
)

// appSchemePattern is the allowlist for the deep link target.
//
// The app sends its own application id, which varies: a local build carries a
// suffix so it can be installed alongside the published one, and each needs its
// own scheme or Android offers a chooser between two copies of the same app.
// That is a value from the client, though, and a redirect target taken from a
// client is an open redirect — so it is matched against this rather than used.
var appSchemePattern = regexp.MustCompile(`^io\.blurrycontour\.activitylens(\.[a-z0-9]{1,16})?$`)

// challengePattern is base64url of a SHA-256 digest, unpadded: 43 characters.
var challengePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// nativeAuthCode is a completed sign-in waiting to be collected by the app.
type nativeAuthCode struct {
	sessionID string
	expiresAt time.Time
	user      *auth.User
	challenge string
	issued    time.Time
}

// nativeAuthCodes holds codes between the redirect and the exchange.
//
// In memory, not in the database. These live for two minutes, are single-use,
// and losing them all on restart costs nothing worse than one sign-in that has
// to be repeated — against a schema migration and a row to clean up for a value
// whose whole purpose is to stop existing.
type nativeAuthCodes struct {
	mu sync.Mutex
	m  map[string]nativeAuthCode
}

func newNativeAuthCodes() *nativeAuthCodes {
	return &nativeAuthCodes{m: make(map[string]nativeAuthCode)}
}

func (c *nativeAuthCodes) issue(code string, entry nativeAuthCode) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// Swept here rather than by a goroutine: the map only grows when someone
	// signs in, so the moment it grows is exactly when it is worth pruning.
	for k, v := range c.m {
		if time.Since(v.issued) > nativeCodeTTL {
			delete(c.m, k)
		}
	}
	c.m[code] = entry
}

// take removes a code and returns it. Removal happens whether or not the entry
// turns out to be usable: a code that has been presented once is spent, which is
// what stops a guessed or intercepted one from being retried against verifiers.
func (c *nativeAuthCodes) take(code string) (nativeAuthCode, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.m[code]
	delete(c.m, code)
	if !ok || time.Since(entry.issued) > nativeCodeTTL {
		return nativeAuthCode{}, false
	}
	return entry, true
}

// handleOIDCLogin starts the flow, noting the native parameters when they are
// present and otherwise behaving exactly as the web flow always has.
func (s *Server) handleOIDCLogin(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	challenge := q.Get("native")
	if challenge == "" {
		s.oidc.Login(w, r)
		return
	}
	scheme := q.Get("scheme")
	if !challengePattern.MatchString(challenge) || !appSchemePattern.MatchString(scheme) {
		// A browser opened this by hand, or something is trying to aim the
		// redirect elsewhere. Either way the web flow is the safe answer.
		slog.Warn("rejected native oidc parameters", "ip", clientIP(r))
		writeError(w, http.StatusBadRequest, "invalid native sign-in request")
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name:     nativeFlowCookie,
		Value:    scheme + " " + challenge,
		Path:     "/",
		MaxAge:   int(nativeFlowTTL.Seconds()),
		HttpOnly: true,
		Secure:   s.secure(r),
		// The provider redirects back with a top-level GET, which Lax allows and
		// Strict would not — the cookie would simply not arrive.
		SameSite: http.SameSiteLaxMode,
	})
	s.oidc.Login(w, r)
}

// takeNativeFlow reads and clears the flow cookie.
func (s *Server) takeNativeFlow(w http.ResponseWriter, r *http.Request) (scheme, challenge string, ok bool) {
	cookie, err := r.Cookie(nativeFlowCookie)
	if err != nil || cookie.Value == "" {
		return "", "", false
	}
	http.SetCookie(w, &http.Cookie{
		Name: nativeFlowCookie, Value: "", Path: "/", MaxAge: -1,
		HttpOnly: true, Secure: s.secure(r), SameSite: http.SameSiteLaxMode,
	})
	scheme, challenge, found := strings.Cut(cookie.Value, " ")
	if !found || !appSchemePattern.MatchString(scheme) || !challengePattern.MatchString(challenge) {
		return "", "", false
	}
	return scheme, challenge, true
}

// finishNativeOIDC hands the completed sign-in to the app as a one-time code.
//
// Note what is *not* done here: no session cookie is set. The browser that ran
// the flow has no further part in it, and leaving it holding a live session
// would be a second copy of the credential nobody asked for.
func (s *Server) finishNativeOIDC(w http.ResponseWriter, r *http.Request, scheme, challenge, sid string, exp time.Time, user *auth.User) {
	code, err := auth.RandomToken(32)
	if err != nil {
		slog.Error("could not mint a native sign-in code", "error", err)
		writeError(w, http.StatusInternalServerError, "could not complete sign-in")
		return
	}
	s.nativeCodes.issue(code, nativeAuthCode{
		sessionID: sid, expiresAt: exp, user: user, challenge: challenge, issued: time.Now(),
	})
	http.Redirect(w, r, scheme+"://auth?code="+url.QueryEscape(code), http.StatusFound)
}

// handleOIDCExchange trades the code and the app's verifier for a bearer token.
//
// Public and CSRF-exempt, like /api/auth/token: there is no ambient credential
// to forge here — the request carries everything it is authorised by, and a
// hostile page that made this call would have to already know both secrets.
func (s *Server) handleOIDCExchange(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Code     string `json:"code"`
		Verifier string `json:"verifier"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	entry, ok := s.nativeCodes.take(req.Code)
	if !ok {
		slog.Warn("native sign-in code rejected", "ip", clientIP(r))
		writeError(w, http.StatusUnauthorized, "this sign-in has expired; please try again")
		return
	}
	// The verifier proves the caller is the app that started the flow, and not
	// whoever else the deep link reached. Constant-time, because a comparison
	// that returns early leaks how much of a guess was right.
	sum := sha256.Sum256([]byte(req.Verifier))
	want := base64.RawURLEncoding.EncodeToString(sum[:])
	if subtle.ConstantTimeCompare([]byte(want), []byte(entry.challenge)) != 1 {
		slog.Warn("native sign-in verifier did not match", "ip", clientIP(r))
		writeError(w, http.StatusUnauthorized, "this sign-in could not be verified")
		return
	}
	slog.Info("login (oidc, native)", "user", entry.user.Username, "user_id", entry.user.ID, "ip", clientIP(r))
	writeJSON(w, http.StatusOK, map[string]any{
		"token":     entry.sessionID,
		"expiresAt": entry.expiresAt.UTC().Format(time.RFC3339),
		"user":      entry.user,
	})
}
