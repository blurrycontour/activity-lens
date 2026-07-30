package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// The Android app, served by the server it belongs to.
//
// The APK is built from this same commit and copied into the image, so a
// deployment hands out the app that was built alongside it. Two things follow,
// and both are the reason for doing it this way:
//
//   - A client can never run ahead of its server. Upgrading the server is what
//     offers users a new app; there is no second source that could be newer.
//   - Nothing external is needed to install or update. No GitHub, no internet
//     beyond the server itself, which is what a self-hosted app should require.
//
// The cost is roughly 4 MB of image size, and that an image built without an
// APK simply does not offer one — the endpoints report unavailable rather than
// falling back to somewhere else. A fallback would reintroduce exactly the
// version-drift and signing-key confusion this arrangement removes.

// apkMetadata is written next to the APK by scripts/apk.sh.
//
// The version is read from here rather than assumed to equal the server's own.
// They agree when both come from one build, but a hand-assembled image could
// pair any two, and reporting a version the file does not actually have would
// send a phone into an update loop it could never satisfy.
type apkMetadata struct {
	Version     string `json:"version"`
	VersionCode int64  `json:"versionCode"`
	BuildType   string `json:"buildType"`
	File        string `json:"file"`
	SHA256      string `json:"sha256"`
}

// androidAppInfo is what a client needs to decide whether to offer a download.
type androidAppInfo struct {
	Available bool `json:"available"`
	// Version of the bundled APK, e.g. "1.4.2".
	Version string `json:"version,omitempty"`
	// Size in bytes, so a download can show a total before it starts.
	Size int64 `json:"size,omitempty"`
	// SHA256 of the APK, for anyone who wants to verify what they installed.
	SHA256 string `json:"sha256,omitempty"`
	// DownloadPath on this server.
	DownloadPath string `json:"downloadPath,omitempty"`
}

// bundledAPK is the resolved APK, or nil when the image carries none.
type bundledAPK struct {
	path string
	meta apkMetadata
	size int64
}

// loadBundledAPK reads the APK metadata once at startup.
//
// Resolved eagerly rather than per request: it is a constant for the lifetime of
// the process, and a missing or malformed bundle should be visible in the logs
// at boot rather than discovered by the first user who taps download.
func loadBundledAPK(dir string) *bundledAPK {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return nil
	}
	raw, err := os.ReadFile(filepath.Join(dir, "apk.json"))
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Warn("could not read bundled apk metadata", "dir", dir, "error", err)
		}
		return nil
	}
	var meta apkMetadata
	if err := json.Unmarshal(raw, &meta); err != nil {
		slog.Warn("bundled apk metadata is not valid json", "dir", dir, "error", err)
		return nil
	}
	// Only the base name is used: the metadata is generated, but it names a file
	// this process then opens, and a path from a file is not a path to follow.
	name := filepath.Base(meta.File)
	if name == "." || name == ".." || name == "" || meta.Version == "" {
		slog.Warn("bundled apk metadata is incomplete", "dir", dir, "file", meta.File)
		return nil
	}
	path := filepath.Join(dir, name)
	info, err := os.Stat(path)
	if err != nil {
		slog.Warn("bundled apk metadata names a file that is not there", "path", path, "error", err)
		return nil
	}

	slog.Info("android app bundled", "version", meta.Version, "build", meta.BuildType, "size", info.Size())
	return &bundledAPK{path: path, meta: meta, size: info.Size()}
}

// androidApp resolves what this server offers, or a zero value when it offers
// nothing.
func (s *Server) androidApp() androidAppInfo {
	if !s.cfg.AndroidApp || s.apk == nil {
		return androidAppInfo{}
	}
	return androidAppInfo{
		Available:    true,
		Version:      s.apk.meta.Version,
		Size:         s.apk.size,
		SHA256:       s.apk.meta.SHA256,
		DownloadPath: "/api/app/android/download",
	}
}

// handleAndroidApp reports the app this server carries.
//
// Public, unlike /api/build: the download link is on the login page, which by
// definition has no session, and the app checks for updates before anyone signs
// in. The trade-off is deliberate but real — it tells an anonymous caller the
// server's app version. Any operator who would rather not say can set
// AL_ANDROID_APP=false.
func (s *Server) handleAndroidApp(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.androidApp())
}

// handleAndroidDownload serves the bundled APK.
//
// http.ServeFile rather than a hand-rolled copy: it handles range requests and
// conditional gets for free, so a download interrupted on a phone resumes
// instead of starting again.
func (s *Server) handleAndroidDownload(w http.ResponseWriter, r *http.Request) {
	if !s.androidApp().Available {
		writeError(w, http.StatusNotFound, "this server does not bundle the Android app")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.android.package-archive")
	w.Header().Set("Content-Disposition", contentDisposition(filepath.Base(s.apk.path)))
	http.ServeFile(w, r, s.apk.path)
}
