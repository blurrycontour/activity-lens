// Package web embeds the compiled single-page application and serves it with
// SPA fallback (unknown non-API routes return index.html).
package web

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// Files that must never be served from a stale browser cache. A pinned service
// worker keeps a client on an old build indefinitely, because the worker script
// is what triggers the update check in the first place.
var noStoreFiles = map[string]bool{
	"sw.js":                true,
	"manifest.webmanifest": true,
}

//go:embed all:dist
var dist embed.FS

// Assets returns the embedded frontend as an fs.FS rooted at the build output.
func Assets() (fs.FS, error) {
	return fs.Sub(dist, "dist")
}

// Handler serves the SPA: static assets when they exist, otherwise index.html
// so client-side routing works on deep links.
func Handler() (http.Handler, error) {
	assets, err := Assets()
	if err != nil {
		return nil, err
	}
	fileServer := http.FileServer(http.FS(assets))
	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		return nil, err
	}
	// Go's built-in type table has no entry for .webmanifest, so the manifest
	// would go out as text/plain and browsers would refuse to install the PWA.
	if err := mime.AddExtensionType(".webmanifest", "application/manifest+json"); err != nil {
		return nil, err
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		// http.FileServer answers "/index.html" with a 301 to "/". The service
		// worker precaches the shell under its real name and fetches it during
		// install, where a redirect makes the response uncacheable and takes
		// offline support down with it — so serve the shell directly instead.
		if p == "" || p == "index.html" {
			serveIndex(w, index)
			return
		}
		// A missing file with an extension is a missing file, not a route.
		//
		// Falling back to the shell for those is what turns "this build no
		// longer has that chunk" into "Failed to load module script: the
		// server responded with a non-JavaScript MIME type of text/html" —
		// which is a browser describing our index.html, several steps removed
		// from the thing that actually went wrong. It happens the moment a
		// client holding yesterday's HTML asks for yesterday's hashed asset,
		// and the page it breaks is whichever one loads that chunk.
		//
		// The app's own routes never contain a dot: they are /workouts/{id},
		// /users/{id}, /admin/users/{id}, and every id it mints is
		// alphanumeric. So a dot in the last segment means a file was asked
		// for, and the honest answer for one we do not have is 404.
		if _, err := assets.Open(p); err != nil && strings.Contains(path.Base(p), ".") {
			http.NotFound(w, r)
			return
		}
		if f, err := assets.Open(p); err == nil {
			_ = f.Close()
			if noStoreFiles[p] {
				w.Header().Set("Cache-Control", "no-cache")
			}
			// Static assets are content-hashed and never need byte-range
			// serving (no audio/video). Some reverse proxies compress
			// responses on the fly (e.g. Caddy's "encode" directive); if
			// they also honor a client's Range/If-Range request against the
			// advertised Accept-Ranges/Content-Length of the *uncompressed*
			// body, the two lengths disagree mid-stream and the proxy resets
			// the HTTP/2 stream (curl: "stream was not closed cleanly").
			// Dropping these headers keeps every asset response a plain,
			// single, fully-buffered 200 that compresses safely.
			r.Header.Del("Range")
			r.Header.Del("If-Range")
			fileServer.ServeHTTP(w, r)
			return
		}
		serveIndex(w, index)
	}), nil
}

func serveIndex(w http.ResponseWriter, index []byte) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = w.Write(index)
}
