package sessions

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/store"
)

// The client header is free text from any signed-in client and is rendered in
// an admin's device list. Both halves of that sentence are why this is tested:
// a made-up kind must not appear as though it were a platform, and a version
// must not be able to carry markup or a kilobyte of anything.
func TestParseClientHeader(t *testing.T) {
	cases := []struct {
		in         string
		kind       string
		appVersion string
	}{
		{"web/1.11.1", KindWeb, "1.11.1"},
		{"android/1.11.1", KindAndroid, "1.11.1"},
		{" Android/1.11.1 ", KindAndroid, "1.11.1"},
		{"WEB/2.0.0-rc1", KindWeb, "2.0.0-rc1"},
		// No version is fine: an older build that names itself and nothing else.
		{"web", KindWeb, ""},
		{"web/", KindWeb, ""},
		// Not a client we know. Stored as nothing rather than echoed back.
		{"ios/1.0.0", "", ""},
		{"", "", ""},
		{"/1.0.0", "", ""},
		{"<script>/1.0", "", ""},
		// A recognised kind with an unusable version keeps the kind and drops
		// the version, rather than throwing away the fact we do have.
		{"web/<script>alert(1)</script>", KindWeb, ""},
		{"web/1.0 OR 1=1", KindWeb, ""},
	}
	for _, c := range cases {
		got := ParseClientHeader(c.in)
		if got.Kind != c.kind || got.AppVersion != c.appVersion {
			t.Errorf("ParseClientHeader(%q) = {%q, %q}, want {%q, %q}",
				c.in, got.Kind, got.AppVersion, c.kind, c.appVersion)
		}
	}
}

func TestParseClientHeaderTruncatesLongVersions(t *testing.T) {
	long := ""
	for range 200 {
		long += "9"
	}
	got := ParseClientHeader("web/" + long)
	if len(got.AppVersion) > maxVersionLen {
		t.Errorf("version kept %d chars, want at most %d", len(got.AppVersion), maxVersionLen)
	}
}

// Labelling a device is the whole point; getting the browser wrong on a list of
// "is this still me" is worse than saying nothing, which is why anything
// unrecognised comes back empty rather than guessed.
func TestParseAgent(t *testing.T) {
	cases := []struct {
		name     string
		ua       string
		browser  string
		platform string
		mobile   bool
	}{
		{
			"chrome on linux",
			"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
			"Chrome 141", "Linux", false,
		},
		{
			// Edge says Chrome and Safari too; the most specific name has to win.
			"edge on windows",
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.3537.57",
			"Edge 141", "Windows", false,
		},
		{
			"firefox on macos",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0",
			"Firefox 133", "macOS", false,
		},
		{
			// Android also claims Linux, so the order in platformOf matters.
			"chrome on android",
			"Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
			"Chrome 141", "Android", true,
		},
		{
			// Chrome on iOS is CriOS and is still Chrome to a person reading it.
			"chrome on iphone",
			"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
			"Chrome 141", "iPhone", true,
		},
		{
			"safari on macos",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
			"Safari 17", "macOS", false,
		},
		// Nothing recognisable is reported as nothing. The caller shows the raw
		// agent, which is more honest than "Unknown on Unknown".
		{"empty", "", "", "", false},
		{"nonsense", "curl/8.5.0", "", "", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := ParseAgent(c.ua)
			if got.Browser != c.browser {
				t.Errorf("Browser = %q, want %q", got.Browser, c.browser)
			}
			if got.Platform != c.platform {
				t.Errorf("Platform = %q, want %q", got.Platform, c.platform)
			}
			if got.Mobile != c.mobile {
				t.Errorf("Mobile = %v, want %v", got.Mobile, c.mobile)
			}
		})
	}
}

func TestParseAgentSpotsAWebView(t *testing.T) {
	// The Android app is a WebView, and its agent is the only hint of that in
	// the absence of the client header — which is what a session predating the
	// header tracking looks like.
	ua := "Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36"
	if got := ParseAgent(ua); !got.WebView {
		t.Error("WebView = false for an Android WebView agent")
	}
	plain := "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36"
	if got := ParseAgent(plain); got.WebView {
		t.Error("WebView = true for an ordinary mobile browser")
	}
}

func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := store.OpenSQLite(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("OpenSQLite() error = %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.MigrateApp(context.Background(), db); err != nil {
		t.Fatalf("MigrateApp() error = %v", err)
	}
	return db
}

// Record runs at login and then from the request path, where the client header
// may be absent — a background fetch, an older build. What was learned at login
// must survive that, or a device would announce itself as the Android app and
// then quietly become unlabelled.
func TestRecordKeepsWhatWasLearnedAtLogin(t *testing.T) {
	ctx := context.Background()
	s := NewStore(newTestDB(t))

	if err := s.Record(ctx, "sess1", 1, Client{Kind: KindAndroid, AppVersion: "1.11.1"}); err != nil {
		t.Fatal(err)
	}
	first, err := s.ForSessions(ctx, []string{"sess1"})
	if err != nil {
		t.Fatal(err)
	}
	seenAt := first["sess1"].LastSeen
	if seenAt == "" {
		t.Fatal("no last_seen recorded")
	}

	// A later request that says nothing about itself.
	if err := s.Record(ctx, "sess1", 1, Client{}); err != nil {
		t.Fatal(err)
	}
	got, err := s.ForSessions(ctx, []string{"sess1"})
	if err != nil {
		t.Fatal(err)
	}
	if got["sess1"].Kind != KindAndroid || got["sess1"].AppVersion != "1.11.1" {
		t.Errorf("after an anonymous request the client became {%q, %q}, want the android app it was",
			got["sess1"].Kind, got["sess1"].AppVersion)
	}

	// And an upgrade does move the version on.
	if err := s.Record(ctx, "sess1", 1, Client{Kind: KindAndroid, AppVersion: "1.12.0"}); err != nil {
		t.Fatal(err)
	}
	got, _ = s.ForSessions(ctx, []string{"sess1"})
	if got["sess1"].AppVersion != "1.12.0" {
		t.Errorf("AppVersion = %q after an upgrade, want 1.12.0", got["sess1"].AppVersion)
	}
}

func TestForSessionsHandlesUnknownAndEmpty(t *testing.T) {
	ctx := context.Background()
	s := NewStore(newTestDB(t))
	if err := s.Record(ctx, "known", 1, Client{Kind: KindWeb}); err != nil {
		t.Fatal(err)
	}
	// A session predating this table is a normal row to render, not an error.
	got, err := s.ForSessions(ctx, []string{"known", "never-seen"})
	if err != nil {
		t.Fatalf("ForSessions() error = %v", err)
	}
	if len(got) != 1 || got["known"].Kind != KindWeb {
		t.Errorf("got %+v, want only the known session", got)
	}
	// The empty case has to short-circuit: the IN clause is built by repeating
	// placeholders, and repeating it len-1 times would panic on zero.
	if got, err := s.ForSessions(ctx, nil); err != nil || len(got) != 0 {
		t.Errorf("ForSessions(nil) = %v, %v", got, err)
	}
}

// go-authkit deletes a session row on revoke and knows nothing about this
// table, so without the prune these rows would accumulate for the life of the
// instance.
func TestPruneOrphansDropsRevokedSessionsOnly(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	s := NewStore(db)

	// The sessions table belongs to go-authkit; stand in for its shape.
	if _, err := db.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY, public_id TEXT, user_id INTEGER, user_agent TEXT, ip TEXT,
		created_at TEXT DEFAULT '', expires_at TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx,
		`INSERT INTO sessions (id, public_id, user_id) VALUES ('live', 'p1', 1)`); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"live", "revoked"} {
		if err := s.Record(ctx, id, 1, Client{Kind: KindWeb}); err != nil {
			t.Fatal(err)
		}
	}

	n, err := s.PruneOrphans(ctx)
	if err != nil {
		t.Fatalf("PruneOrphans() error = %v", err)
	}
	if n != 1 {
		t.Errorf("pruned %d rows, want 1", n)
	}
	got, _ := s.ForSessions(ctx, []string{"live", "revoked"})
	if _, ok := got["live"]; !ok {
		t.Error("the live session's client row was pruned")
	}
	if _, ok := got["revoked"]; ok {
		t.Error("the revoked session's client row survived")
	}
	seen, err := s.LastSeenFor(ctx, []int64{1})
	if err != nil {
		t.Fatal(err)
	}
	if seen[1] == "" {
		t.Error("pruning a revoked session erased the user's last seen time")
	}
}

func TestPurgeUserRemovesOnlyThatUser(t *testing.T) {
	ctx := context.Background()
	s := NewStore(newTestDB(t))
	if err := s.Record(ctx, "a", 1, Client{Kind: KindWeb}); err != nil {
		t.Fatal(err)
	}
	if err := s.Record(ctx, "b", 2, Client{Kind: KindWeb}); err != nil {
		t.Fatal(err)
	}
	if err := s.PurgeUser(ctx, 1); err != nil {
		t.Fatalf("PurgeUser() error = %v", err)
	}
	got, _ := s.ForSessions(ctx, []string{"a", "b"})
	if _, ok := got["a"]; ok {
		t.Error("the purged user's row survived")
	}
	if _, ok := got["b"]; !ok {
		t.Error("another user's row was purged")
	}
	seen, err := s.LastSeenFor(ctx, []int64{1, 2})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := seen[1]; ok {
		t.Error("the purged user's presence survived")
	}
	if seen[2] == "" {
		t.Error("another user's presence was purged")
	}
}

// "Last seen" is a fact about a person, not about one of their devices: sign in
// on a laptop in March and on a phone this morning, and the answer is this
// morning. A user with no rows at all must come back absent rather than as an
// empty string, because the caller renders the two differently — one is "we
// don't know", the other would read as "never".
func TestLastSeenForTakesTheNewestDevice(t *testing.T) {
	ctx := context.Background()
	db := newTestDB(t)
	s := NewStore(db)

	for _, id := range []string{"old", "new"} {
		if err := s.Record(ctx, id, 7, Client{Kind: KindWeb}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Record(ctx, "other", 8, Client{Kind: KindAndroid}); err != nil {
		t.Fatal(err)
	}
	// Backdate one of user 7's two devices, and blank the column on a third to
	// stand in for a session that predates it.
	if _, err := db.ExecContext(ctx,
		`UPDATE session_clients SET last_seen = '2026-03-01T09:00:00Z' WHERE session_id = 'old'`); err != nil {
		t.Fatal(err)
	}
	if err := s.Record(ctx, "blank", 9, Client{}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx,
		`UPDATE session_clients SET last_seen = '' WHERE session_id = 'blank'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `DELETE FROM user_presence WHERE user_id = 9`); err != nil {
		t.Fatal(err)
	}

	got, err := s.LastSeenFor(ctx, []int64{7, 8, 9, 10})
	if err != nil {
		t.Fatalf("LastSeenFor() error = %v", err)
	}
	if got[7] == "2026-03-01T09:00:00Z" || got[7] == "" {
		t.Errorf("user 7 last seen = %q, want the newer of their two devices", got[7])
	}
	if got[8] == "" {
		t.Error("user 8 has a session and no last seen")
	}
	if _, ok := got[9]; ok {
		t.Errorf("user 9 has only a blank last_seen, want no entry, got %q", got[9])
	}
	if _, ok := got[10]; ok {
		t.Error("user 10 has no sessions at all, want no entry")
	}
}
