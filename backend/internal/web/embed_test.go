package web

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// The PWA depends on a handful of properties of the static handler that are
// easy to regress and that fail silently in a browser (the app simply stops
// working offline, or refuses to install). Pin them here.
func TestHandlerPWAContract(t *testing.T) {
	h, err := Handler()
	if err != nil {
		t.Fatalf("Handler() error = %v", err)
	}

	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		return rec
	}

	t.Run("index.html is served, not redirected", func(t *testing.T) {
		// The service worker precaches the shell under this exact URL and
		// fetches it during install; a 301 there breaks offline support.
		rec := get("/index.html")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); ct != "text/html; charset=utf-8" {
			t.Fatalf("Content-Type = %q, want text/html", ct)
		}
	})

	/*
		A hashed asset that this build does not have must 404 rather than be
		answered with the shell.

		Serving index.html there is how a client holding yesterday's HTML — a
		pinned service worker, a proxy cache, a tab left open across a deploy —
		gets told "Failed to load module script: the server responded with a
		non-JavaScript MIME type of text/html". The map simply does not appear,
		and the message names the wrong thing entirely.
	*/
	t.Run("a missing asset is a 404, not the shell", func(t *testing.T) {
		for _, p := range []string{
			"/assets/maplibre-DEADBEEF.js",
			"/assets/index-00000000.css",
			"/nope.mjs",
		} {
			if rec := get(p); rec.Code != http.StatusNotFound {
				t.Errorf("GET %s = %d, want 404 (body starts %.20q)", p, rec.Code, rec.Body.String())
			}
		}
	})

	t.Run("deep links fall back to the shell", func(t *testing.T) {
		// Every route the app mints is dot-free, which is what lets the rule
		// above tell a route from a file. If that ever stops being true, this
		// is the test that says so.
		for _, p := range []string{"/users/42", "/admin/users/42", "/equipment/e_277564788d8a", "/plans"} {
			if rec := get(p); rec.Code != http.StatusOK {
				t.Errorf("GET %s = %d, want the shell", p, rec.Code)
			}
		}
		rec := get("/workouts/w_abc123")
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
	})

	// The remaining cases need the real build output. The repository ships a
	// placeholder dist/ containing only index.html, so skip rather than fail
	// when the frontend has not been built into it.
	assets, err := Assets()
	if err != nil {
		t.Fatalf("Assets() error = %v", err)
	}

	t.Run("manifest content type", func(t *testing.T) {
		if _, err := assets.Open("manifest.webmanifest"); err != nil {
			t.Skip("no built frontend embedded")
		}
		rec := get("/manifest.webmanifest")
		// Browsers reject a manifest served as text/plain, which Go's default
		// type table would otherwise do for this extension.
		if ct := rec.Header().Get("Content-Type"); ct != "application/manifest+json" {
			t.Fatalf("Content-Type = %q, want application/manifest+json", ct)
		}
	})

	t.Run("service worker is not cacheable", func(t *testing.T) {
		if _, err := assets.Open("sw.js"); err != nil {
			t.Skip("no built frontend embedded")
		}
		rec := get("/sw.js")
		if cc := rec.Header().Get("Cache-Control"); cc != "no-cache" {
			// A cached worker script pins clients to an old build, because the
			// worker is what checks for updates.
			t.Fatalf("Cache-Control = %q, want no-cache", cc)
		}
	})
}
