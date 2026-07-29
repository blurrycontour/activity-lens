package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/blurrycontour/go-authkit/auth"
)

// decodeJSON rejects unknown fields, which makes every request shape a contract
// with the browser. These pin the shapes we do not control.

// The browser's PushSubscription.toJSON() always includes expirationTime, and
// omitting it from the request struct made every subscribe attempt a 400 —
// while the UI still reported push as enabled, because the browser's own
// subscription had succeeded. Silent, and it shipped.
func TestPushSubscribeAcceptsBrowserPayload(t *testing.T) {
	body := `{"endpoint":"https://push.example/x","expirationTime":null,` +
		`"keys":{"p256dh":"BFY9Oxw6","auth":"lwuboAdZ"}}`

	var req pushSubscribeRequest
	r := httptest.NewRequest("POST", "/api/push/subscribe", strings.NewReader(body))
	if err := decodeJSON(r, &req); err != nil {
		t.Fatalf("rejected the shape the browser actually sends: %v", err)
	}
	if req.Endpoint == "" || req.Keys.P256dh == "" || req.Keys.Auth == "" {
		t.Fatalf("decoded to %+v; the fields we rely on were dropped", req)
	}
}

// An expirationTime with a value (some browsers set one) must not break it
// either.
func TestPushSubscribeAcceptsExpiryValue(t *testing.T) {
	body := `{"endpoint":"https://push.example/x","expirationTime":1799999999999,` +
		`"keys":{"p256dh":"a","auth":"b"}}`
	var req pushSubscribeRequest
	r := httptest.NewRequest("POST", "/api/push/subscribe", strings.NewReader(body))
	if err := decodeJSON(r, &req); err != nil {
		t.Fatalf("rejected a subscription carrying an expiry: %v", err)
	}
}

// Every user must resolve to a picture. Push notification icons and the share
// picker both assume this, and "no avatar" reaching either of them is what the
// generated-avatar work was for.
func TestEffectiveAvatarAlwaysResolves(t *testing.T) {
	uploaded := effectiveAvatar(auth.User{Username: "alice", AvatarPath: "/api/avatars/1-2.jpg"})
	if uploaded != "/api/avatars/1-2.jpg" {
		t.Fatalf("an upload must win: got %q", uploaded)
	}

	generated := effectiveAvatar(auth.User{Username: "alice"})
	if generated == "" {
		t.Fatal("a user with no upload must still resolve to the generated avatar")
	}
	if !strings.HasPrefix(generated, avatarURLPrefix+"auto/") {
		t.Fatalf("generated avatar URL = %q, want the auto route", generated)
	}
	// Usernames go into a path segment, so anything path-like has to be escaped
	// rather than able to walk out of it.
	escaped := effectiveAvatar(auth.User{Username: "../../etc/passwd"})
	if strings.Contains(strings.TrimPrefix(escaped, avatarURLPrefix+"auto/"), "/") {
		t.Fatalf("username was not escaped into the path: %q", escaped)
	}
}

// The user directory is readable by every signed-in user, unlike the admin
// listing. It must never carry an email address.
func TestUserRefOmitsEmail(t *testing.T) {
	ref := userRef(auth.User{
		ID: 7, Username: "kim", DisplayName: "Kim",
		Email: "kim@private.example", IsAdmin: true, Role: "administrator",
	})
	encoded, err := json.Marshal(ref)
	if err != nil {
		t.Fatal(err)
	}
	for _, leak := range []string{"kim@private.example", "administrator", "isAdmin"} {
		if strings.Contains(string(encoded), leak) {
			t.Errorf("user directory entry leaks %q: %s", leak, encoded)
		}
	}
}

// The archived filename came from an upload form, so it reaches the download
// header as untrusted text. A newline in it would let a caller append their own
// response headers; a path would let the browser write outside its downloads
// folder. Neither is reachable through the normal UI, which is exactly why it
// needs a test rather than a careful reader.
func TestContentDispositionSanitizesFilenames(t *testing.T) {
	tests := []struct {
		name      string
		filename  string
		wantASCII string
	}{
		{"plain name is kept", "morning run.gpx", `"morning run.gpx"`},
		{"header injection is neutralized", "a\r\nX-Evil: 1.gpx", `"a__X-Evil: 1.gpx"`},
		{"quotes cannot close the value", `a"b.gpx`, `"a_b.gpx"`},
		{"path traversal is stripped", "../../etc/passwd", `"passwd"`},
		{"windows path is stripped", `C:\Windows\evil.gpx`, `"evil.gpx"`},
		{"non-ascii falls back in the quoted form", "läuf.gpx", `"l_uf.gpx"`},
		{"an empty name still downloads", "", `"workout"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := contentDisposition(tt.filename)
			if !strings.Contains(got, tt.wantASCII) {
				t.Errorf("contentDisposition(%q) = %q, want it to contain %s", tt.filename, got, tt.wantASCII)
			}
			if strings.ContainsAny(got, "\r\n") {
				t.Errorf("contentDisposition(%q) = %q, which can inject headers", tt.filename, got)
			}
		})
	}

	// The RFC 5987 form is what carries the real name to browsers that read it,
	// so a non-ASCII name must survive there even though the quoted copy cannot.
	if got := contentDisposition("läuf.gpx"); !strings.Contains(got, "filename*=UTF-8''l%C3%A4uf.gpx") {
		t.Errorf("contentDisposition() = %q, want the encoded name in filename*", got)
	}
}
