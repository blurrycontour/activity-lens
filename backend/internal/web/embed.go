// Package web embeds the compiled single-page application and serves it with
// SPA fallback (unknown non-API routes return index.html).
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

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

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			serveIndex(w, index)
			return
		}
		if f, err := assets.Open(p); err == nil {
			_ = f.Close()
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
