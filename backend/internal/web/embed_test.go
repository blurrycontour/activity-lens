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

	t.Run("deep links fall back to the shell", func(t *testing.T) {
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
