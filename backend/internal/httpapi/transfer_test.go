package httpapi

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// The whole point of this middleware is to change what crosses the wire while
// changing nothing a client can observe about the content. Every failure mode
// is silent in exactly the wrong way: a 304 served for a body the client does
// not have shows as stale data, a gzipped body without the header shows as
// garbage, and a POST answered from a cache shows as a write that vanished.

func jsonHandler(body string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, body)
	})
}

// A body long enough to be worth compressing, and repetitive enough that it
// certainly will be.
func bigJSON() string {
	return `{"points":[` + strings.Repeat(`{"lat":51.5074,"lng":-0.1278},`, 400) + `null]}`
}

func serve(t *testing.T, h http.Handler, method, target string, header http.Header) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	for k, v := range header {
		req.Header[k] = v
	}
	rec := httptest.NewRecorder()
	withJSONTransfer(h).ServeHTTP(rec, req)
	return rec.Result()
}

func TestJSONTransferCompressesAndRoundTrips(t *testing.T) {
	body := bigJSON()
	res := serve(t, jsonHandler(body), http.MethodGet, "/api/workouts/x",
		http.Header{"Accept-Encoding": {"gzip"}})

	if got := res.Header.Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	// Caches key on this, and getting it wrong feeds a gzipped body to a
	// client that asked for plain.
	if !strings.Contains(res.Header.Get("Vary"), "Accept-Encoding") {
		t.Errorf("Vary = %q, want it to mention Accept-Encoding", res.Header.Get("Vary"))
	}

	raw, _ := io.ReadAll(res.Body)
	zr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("body is not gzip: %v", err)
	}
	got, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("read gzip body: %v", err)
	}
	if string(got) != body {
		t.Error("decompressed body differs from what the handler wrote")
	}
	// It has to actually be smaller, or the whole exercise is a CPU cost.
	if len(raw) >= len(body) {
		t.Errorf("compressed to %d bytes from %d — no saving", len(raw), len(body))
	}
	// Content-Length must describe the bytes on the wire, not the original.
	if res.Header.Get("Content-Length") != strconv.Itoa(len(raw)) {
		t.Errorf("Content-Length = %q, want %d", res.Header.Get("Content-Length"), len(raw))
	}
}

func TestJSONTransferLeavesPlainClientsAlone(t *testing.T) {
	body := bigJSON()
	for _, ae := range []string{"", "identity", "gzip;q=0", "br"} {
		res := serve(t, jsonHandler(body), http.MethodGet, "/api/x",
			http.Header{"Accept-Encoding": {ae}})
		if got := res.Header.Get("Content-Encoding"); got != "" {
			t.Errorf("Accept-Encoding %q: Content-Encoding = %q, want none", ae, got)
		}
		got, _ := io.ReadAll(res.Body)
		if string(got) != body {
			t.Errorf("Accept-Encoding %q: body was altered", ae)
		}
	}
}

func TestJSONTransferAnswers304OnlyForTheSameBody(t *testing.T) {
	body := bigJSON()
	first := serve(t, jsonHandler(body), http.MethodGet, "/api/workouts/x", nil)
	etag := first.Header.Get("ETag")
	if etag == "" {
		t.Fatal("no ETag on the first response")
	}

	same := serve(t, jsonHandler(body), http.MethodGet, "/api/workouts/x",
		http.Header{"If-None-Match": {etag}})
	if same.StatusCode != http.StatusNotModified {
		t.Errorf("status = %d, want 304 for an unchanged body", same.StatusCode)
	}
	if n, _ := io.Copy(io.Discard, same.Body); n != 0 {
		t.Errorf("304 carried %d bytes of body", n)
	}
	// A 304 that claims an encoding it is not sending breaks the client that
	// believes it.
	if same.Header.Get("Content-Encoding") != "" || same.Header.Get("Content-Length") != "" {
		t.Error("304 carried Content-Encoding or Content-Length")
	}

	// The response the ETag described has changed, so the client must be sent
	// the new one. This is the case that shows as stale data if it regresses.
	changed := serve(t, jsonHandler(bigJSON()+" "), http.MethodGet, "/api/workouts/x",
		http.Header{"If-None-Match": {etag}})
	if changed.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200 when the body changed", changed.StatusCode)
	}
}

func TestJSONTransferNeverShortCircuitsAWrite(t *testing.T) {
	// A PUT that returns the body it just stored will match the ETag the
	// client already had. Answering 304 would report the write as a no-op.
	body := bigJSON()
	first := serve(t, jsonHandler(body), http.MethodGet, "/api/x", nil)
	etag := first.Header.Get("ETag")

	for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
		res := serve(t, jsonHandler(body), method, "/api/x",
			http.Header{"If-None-Match": {etag}})
		if res.StatusCode != http.StatusOK {
			t.Errorf("%s: status = %d, want 200 — a write is never answered from a cache", method, res.StatusCode)
		}
		if res.Header.Get("ETag") != "" {
			t.Errorf("%s: carried an ETag, which invites a client to cache a write", method)
		}
	}
}

func TestJSONTransferPassesEverythingElseThrough(t *testing.T) {
	// Images, the APK and archived uploads are served by ServeContent and
	// ServeFile, which do their own conditional and range handling and are
	// already compressed. Buffering them here would break both.
	payload := strings.Repeat("\x89PNG\r\n\x1a\n", 400)
	h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/jpeg")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, payload)
	})
	res := serve(t, h, http.MethodGet, "/api/media/x.jpg", http.Header{"Accept-Encoding": {"gzip"}})
	if res.Header.Get("Content-Encoding") != "" || res.Header.Get("ETag") != "" {
		t.Error("a non-JSON response was compressed or tagged")
	}
	got, _ := io.ReadAll(res.Body)
	if string(got) != payload {
		t.Error("a non-JSON body was altered")
	}
}

func TestJSONTransferLeavesErrorsAndEmptyBodiesAlone(t *testing.T) {
	// An error envelope is a few dozen bytes nobody re-requests, and a 204 has
	// no body to hash. Neither should acquire an ETag inviting a 304.
	for _, status := range []int{http.StatusNoContent, http.StatusNotFound, http.StatusInternalServerError} {
		h := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(status)
		})
		res := serve(t, h, http.MethodGet, "/api/x", nil)
		if res.StatusCode != status {
			t.Errorf("status = %d, want %d", res.StatusCode, status)
		}
		if res.Header.Get("ETag") != "" {
			t.Errorf("status %d acquired an ETag", status)
		}
	}
}

func TestJSONTransferHeadSendsNoBody(t *testing.T) {
	res := serve(t, jsonHandler(bigJSON()), http.MethodHead, "/api/x",
		http.Header{"Accept-Encoding": {"gzip"}})
	if n, _ := io.Copy(io.Discard, res.Body); n != 0 {
		t.Errorf("HEAD returned %d bytes of body", n)
	}
	if res.Header.Get("ETag") == "" {
		t.Error("HEAD should still describe the resource")
	}
}

func TestAcceptsGzip(t *testing.T) {
	// "gzip;q=0" contains "gzip" and means the opposite, which is why this is
	// not a substring search.
	cases := map[string]bool{
		"":                             false,
		"gzip":                         true,
		"GZIP":                         true,
		" gzip ":                       true,
		"deflate, gzip;q=1.0, *;q=0.5": true,
		"gzip;q=0":                     false,
		"gzip;q=0.0":                   false,
		"identity":                     false,
		"br":                           false,
		"x-gzip":                       false,
	}
	for header, want := range cases {
		if got := acceptsGzip(header); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", header, got, want)
		}
	}
}

func TestMatchesETag(t *testing.T) {
	const tag = `"abc123"`
	cases := map[string]bool{
		`"abc123"`:          true,
		`W/"abc123"`:        true, // a proxy is entitled to weaken ours
		`"other", "abc123"`: true,
		`*`:                 true,
		`"other"`:           false,
		``:                  false,
		`"abc123x"`:         false,
	}
	for header, want := range cases {
		if got := matchesETag(header, tag); got != want {
			t.Errorf("matchesETag(%q) = %v, want %v", header, got, want)
		}
	}
}
