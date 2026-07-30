package httpapi

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
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

// Losing the last active administrator is unrecoverable from inside the app:
// user management, SSO and email settings are all admin-gated, so there is no
// screen left that could hand the role back. The only fix is editing the
// database by hand.
//
// The rule is about the world after the edit, not about the edit itself — the
// same demotion is fine with two administrators and fatal with one — which is
// why it is worth a table rather than a careful reading.
func TestActiveAdminsAfter(t *testing.T) {
	const (
		soloAdmin  int64 = 1
		otherAdmin int64 = 2
		editor     int64 = 3
	)
	admin := func(id int64, active bool) auth.User {
		return auth.User{ID: id, Role: auth.RoleAdministrator, IsActive: active}
	}

	oneAdmin := []auth.User{
		admin(soloAdmin, true),
		{ID: editor, Role: auth.RoleEditor, IsActive: true},
	}
	twoAdmins := []auth.User{admin(soloAdmin, true), admin(otherAdmin, true)}

	tests := []struct {
		name     string
		users    []auth.User
		targetID int64
		role     string
		isActive bool
		want     int
	}{
		// The cases this guard exists for.
		{"sole admin demotes self to editor", oneAdmin, soloAdmin, auth.RoleEditor, true, 0},
		{"sole admin demotes self to reader", oneAdmin, soloAdmin, auth.RoleReader, true, 0},
		{"sole admin deactivates self", oneAdmin, soloAdmin, auth.RoleAdministrator, false, 0},
		{"sole admin demotes and deactivates at once", oneAdmin, soloAdmin, auth.RoleEditor, false, 0},

		// Legitimate edits that must not be blocked.
		{"one of two admins steps down", twoAdmins, soloAdmin, auth.RoleEditor, true, 1},
		{"one of two admins is deactivated", twoAdmins, otherAdmin, auth.RoleAdministrator, false, 1},
		{"sole admin re-saves unchanged", oneAdmin, soloAdmin, auth.RoleAdministrator, true, 1},
		{"editor is promoted", oneAdmin, editor, auth.RoleAdministrator, true, 2},
		{"editor is deactivated", oneAdmin, editor, auth.RoleEditor, false, 1},

		// An inactive administrator cannot sign in, so they do not count as
		// cover for demoting the one who can.
		{
			"inactive admin does not keep the active one safe",
			[]auth.User{admin(soloAdmin, true), admin(otherAdmin, false)},
			soloAdmin, auth.RoleEditor, true, 0,
		},
		{
			"reactivating the inactive admin counts",
			[]auth.User{admin(soloAdmin, true), admin(otherAdmin, false)},
			otherAdmin, auth.RoleAdministrator, true, 2,
		},

		// An account deleted between the list and the edit leaves the tally
		// alone rather than miscounting it as an administrator.
		{"unknown target changes nothing", twoAdmins, 999, auth.RoleEditor, false, 2},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := activeAdminsAfter(tt.users, tt.targetID, tt.role, tt.isActive)
			if got != tt.want {
				t.Errorf("activeAdminsAfter() = %d, want %d", got, tt.want)
			}
			// What the handler actually branches on, stated explicitly so the
			// intent survives a refactor of the count itself.
			if locked := got == 0; locked != (tt.want == 0) {
				t.Errorf("would %sblock this edit, want the opposite", map[bool]string{true: "", false: "not "}[locked])
			}
		})
	}
}

// deferChecks is what keeps a bulk import from being quadratic: the gear and
// goal checks each re-read the user's whole library, so running them per file
// across a few hundred imports is hundreds of full scans. Absence must mean
// "run them", so that a client which knows nothing about batching — the share
// target, the single-file modal — behaves exactly as it did before the flag
// existed.
func TestFormBoolDefaultsToFalseAndAcceptsTheUsualTruths(t *testing.T) {
	tests := []struct {
		value string
		want  bool
	}{
		{"1", true},
		{"true", true},
		{"TRUE", true},
		{" true ", true},
		{"yes", true},
		{"", false},
		{"0", false},
		{"false", false},
		{"nonsense", false},
	}
	for _, tt := range tests {
		t.Run("value="+tt.value, func(t *testing.T) {
			form := url.Values{"deferChecks": {tt.value}}
			r := httptest.NewRequest("POST", "/api/workouts/import", strings.NewReader(form.Encode()))
			r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			if got := formBool(r, "deferChecks"); got != tt.want {
				t.Errorf("formBool(%q) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}

	// The field omitted entirely — every existing client.
	r := httptest.NewRequest("POST", "/api/workouts/import", strings.NewReader(""))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if formBool(r, "deferChecks") {
		t.Error("an absent deferChecks was read as true, which would silently skip the post-import checks")
	}
}
