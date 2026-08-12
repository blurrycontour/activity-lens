package httpapi

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

/*
Response transfer: conditional requests and compression, for JSON only.

The workout detail is what motivated both. Its series are stored gzipped in
SQLite — the largest workout in a real library is 438 KB on disk — and were then
decompressed, expanded into JSON, and sent uncompressed: 1.8 MB on the wire for
one workout. Neither the database nor the JSON encoder was the cost; the
transfer was.

So:

  - Every JSON response is hashed, and a client that already holds that exact
    body gets a 304 and no body at all.
  - What does go out is gzipped, which on this kind of data is about 4x.

The ETag is computed from the bytes actually produced rather than from an
updated_at somewhere, and that is the whole reason this is safe to apply
blanket. A workout's detail response carries its equipment, its sharing state
and its weather, none of which touch workouts.updated_at — an ETag derived from
a timestamp would have gone stale the moment you linked a pair of shoes from the
gear page. Hashing the answer cannot be stale by construction: if a byte
differs, the ETag differs. The cost is that the handler has already done its
work when we find out nobody needed it, which buys the transfer back and not the
query. The transfer was the expensive half.

Both are deliberately narrow. Only `application/json` is touched: media,
avatars, the APK and archived uploads are served by http.ServeContent and
http.ServeFile, which do their own conditional and range handling, are already
compressed formats, and must keep streaming rather than be buffered here.
*/

// minCompress is the body size below which gzip is not worth it. Under about a
// kilobyte the framing and the CPU cost outweigh what is saved, and most of the
// small responses here are already a few hundred bytes of envelope.
const minCompress = 1024

// gzipPool keeps the writers around. A gzip.Writer allocates a 64 KB window,
// which on a page that fires a dozen requests is worth not doing a dozen times.
var gzipPool = sync.Pool{
	New: func() any {
		w, _ := gzip.NewWriterLevel(nil, gzip.BestSpeed)
		return w
	},
}

// jsonTransferWriter buffers a JSON response so it can be hashed and compressed
// once complete. Anything that is not JSON passes straight through untouched,
// decided at WriteHeader, which is the first moment the content type is known.
type jsonTransferWriter struct {
	http.ResponseWriter
	status      int
	buf         bytes.Buffer
	buffering   bool
	wroteHeader bool
}

func (w *jsonTransferWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.status = status

	// 204 and 304 have no body to work with, and an error envelope is a few
	// dozen bytes that will never be re-requested — so only successful JSON is
	// worth buffering.
	ct := w.Header().Get("Content-Type")
	w.buffering = status == http.StatusOK &&
		strings.HasPrefix(ct, "application/json") &&
		w.Header().Get("Content-Encoding") == ""
	if !w.buffering {
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *jsonTransferWriter) Write(b []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(http.StatusOK)
	}
	if w.buffering {
		return w.buf.Write(b)
	}
	return w.ResponseWriter.Write(b)
}

// Flush is a deliberate no-op while buffering: a handler that flushes mid-JSON
// wants its bytes out now, and this middleware is holding them precisely so it
// can hash the whole thing. Nothing in this API streams JSON. Passing it
// through when not buffering keeps ServeContent behaving as it always has.
func (w *jsonTransferWriter) Flush() {
	if w.buffering {
		return
	}
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// withJSONTransfer adds ETag/If-None-Match and gzip to JSON API responses.
func withJSONTransfer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tw := &jsonTransferWriter{ResponseWriter: w}
		next.ServeHTTP(tw, r)

		if !tw.wroteHeader {
			// A handler that wrote nothing at all; net/http will send its own
			// 200 with an empty body, exactly as before.
			return
		}
		if !tw.buffering {
			return
		}

		body := tw.buf.Bytes()
		h := tw.Header()

		// Only a read can be answered from what the client already holds. A
		// POST that happens to return an identical body still performed the
		// write, and its response is the receipt for that.
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			etag := etagOf(body)
			h.Set("ETag", etag)
			// Without this the ETag is decoration: a browser only sends
			// If-None-Match for a response its cache decided to store, and with
			// no Cache-Control at all that decision is a heuristic that differs
			// between engines. "no-cache" is not "do not cache" — it stores the
			// response and revalidates every time, which is exactly the deal
			// here: never a stale body, but no transfer when nothing changed.
			// Private, because all of this is one person's data.
			//
			// The 304 itself is always the cache's own doing. Nothing in this
			// app sends If-None-Match by hand, so a bodyless 304 can never
			// reach application code that was expecting a workout.
			if h.Get("Cache-Control") == "" {
				h.Set("Cache-Control", "private, no-cache")
			}
			if matchesETag(r.Header.Get("If-None-Match"), etag) {
				// RFC 9110: a 304 carries no body and no Content-Length of its
				// own, and must not claim an encoding it is not sending.
				h.Del("Content-Type")
				h.Del("Content-Length")
				h.Del("Content-Encoding")
				tw.ResponseWriter.WriteHeader(http.StatusNotModified)
				return
			}
		}

		// Whether a cache may reuse this response depends on the request's
		// Accept-Encoding, so it has to be declared even when we decide not to
		// compress this particular one.
		h.Add("Vary", "Accept-Encoding")

		if len(body) >= minCompress && acceptsGzip(r.Header.Get("Accept-Encoding")) {
			var out bytes.Buffer
			zw := gzipPool.Get().(*gzip.Writer)
			zw.Reset(&out)
			_, err := zw.Write(body)
			cerr := zw.Close()
			gzipPool.Put(zw)
			// A compression failure is not a reason to fail the request: the
			// body is right there uncompressed.
			if err == nil && cerr == nil && out.Len() < len(body) {
				body = out.Bytes()
				h.Set("Content-Encoding", "gzip")
			}
		}

		h.Set("Content-Length", strconv.Itoa(len(body)))
		tw.ResponseWriter.WriteHeader(tw.status)
		if r.Method == http.MethodHead {
			return
		}
		if _, err := tw.ResponseWriter.Write(body); err != nil {
			return
		}
	})
}

// etagOf is a strong validator: the bytes hash to it, so two responses share an
// ETag only if they are byte-identical.
func etagOf(body []byte) string {
	sum := sha256.Sum256(body)
	return `"` + base64.RawURLEncoding.EncodeToString(sum[:16]) + `"`
}

// matchesETag reports whether an If-None-Match header covers etag.
//
// The header is a comma-separated list and may be "*". Weak comparison is the
// one the spec asks for here, so a "W/" prefix on either side is ignored — we
// only ever mint strong tags, but a proxy in between is entitled to weaken one.
func matchesETag(header, etag string) bool {
	if header == "" {
		return false
	}
	if strings.TrimSpace(header) == "*" {
		return true
	}
	want := strings.TrimPrefix(etag, "W/")
	for _, part := range strings.Split(header, ",") {
		if strings.TrimPrefix(strings.TrimSpace(part), "W/") == want {
			return true
		}
	}
	return false
}

// acceptsGzip reports whether the client will take a gzipped body.
//
// A q-value of 0 is an explicit refusal, and is the reason this is not a
// substring search: "gzip;q=0" contains "gzip" and means the opposite.
func acceptsGzip(header string) bool {
	for _, part := range strings.Split(header, ",") {
		name, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(name), "gzip") {
			continue
		}
		for _, p := range strings.Split(params, ";") {
			k, v, ok := strings.Cut(strings.TrimSpace(p), "=")
			if ok && strings.EqualFold(strings.TrimSpace(k), "q") {
				if q, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil && q == 0 {
					return false
				}
			}
		}
		return true
	}
	return false
}
