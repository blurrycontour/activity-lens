package httpapi

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/config"
)

// bundleDir writes an APK and its metadata the way scripts/apk.sh does.
func bundleDir(t *testing.T, metaJSON, apkName, apkBody string) string {
	t.Helper()
	dir := t.TempDir()
	if metaJSON != "" {
		if err := os.WriteFile(filepath.Join(dir, "apk.json"), []byte(metaJSON), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if apkName != "" {
		if err := os.WriteFile(filepath.Join(dir, apkName), []byte(apkBody), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

const goodMeta = `{"version":"1.4.2","versionCode":57,"buildType":"release","file":"activity-lens-1.4.2-release.apk","sha256":"abc123"}`

func TestLoadBundledAPK(t *testing.T) {
	t.Run("a complete bundle loads", func(t *testing.T) {
		dir := bundleDir(t, goodMeta, "activity-lens-1.4.2-release.apk", "not really an apk")
		apk := loadBundledAPK(dir)
		if apk == nil {
			t.Fatal("a complete bundle should load")
		}
		if apk.meta.Version != "1.4.2" {
			t.Errorf("version = %q, want 1.4.2", apk.meta.Version)
		}
		if apk.size != int64(len("not really an apk")) {
			t.Errorf("size = %d, want the file's actual size", apk.size)
		}
	})

	// Each of these must yield "no app", not a panic and not a half-configured
	// server that 500s on the first download.
	broken := []struct {
		name    string
		meta    string
		apkName string
	}{
		{"no directory configured", "", ""},
		{"metadata but no apk", goodMeta, ""},
		{"metadata is not json", "{not json", "activity-lens-1.4.2-release.apk"},
		{"metadata has no version", `{"file":"a.apk"}`, "a.apk"},
		{"metadata names no file", `{"version":"1.4.2"}`, "a.apk"},
	}
	for _, tt := range broken {
		t.Run(tt.name, func(t *testing.T) {
			dir := bundleDir(t, tt.meta, tt.apkName, "x")
			if apk := loadBundledAPK(dir); apk != nil {
				t.Errorf("expected no bundle, got %+v", apk.meta)
			}
		})
	}

	t.Run("no directory configured at all", func(t *testing.T) {
		if apk := loadBundledAPK(""); apk != nil {
			t.Error("an unset directory must not resolve to anything")
		}
	})

	// The metadata is generated, but it names a file this process then opens.
	// Only the base name is ever used, so a path cannot escape the bundle dir.
	t.Run("a traversal in the metadata cannot escape", func(t *testing.T) {
		dir := bundleDir(t, `{"version":"1.4.2","file":"../../../etc/passwd"}`, "", "")
		if apk := loadBundledAPK(dir); apk != nil {
			t.Errorf("metadata escaped its directory: %s", apk.path)
		}
	})
}

func serverWithBundle(t *testing.T, enabled bool, dir string) *Server {
	t.Helper()
	s := &Server{cfg: config.Config{AndroidApp: enabled, AndroidAPKDir: dir}}
	s.apk = loadBundledAPK(dir)
	return s
}

func TestAndroidAppAvailability(t *testing.T) {
	full := bundleDir(t, goodMeta, "activity-lens-1.4.2-release.apk", "apk bytes")

	t.Run("a bundled apk is offered", func(t *testing.T) {
		info := serverWithBundle(t, true, full).androidApp()
		if !info.Available {
			t.Fatal("want available")
		}
		if info.Version != "1.4.2" || info.Size != int64(len("apk bytes")) || info.SHA256 != "abc123" {
			t.Errorf("info = %+v, want the bundle's own version, size and checksum", info)
		}
	})

	t.Run("disabled by configuration", func(t *testing.T) {
		if serverWithBundle(t, false, full).androidApp().Available {
			t.Error("AL_ANDROID_APP=false must not offer an app")
		}
	})

	t.Run("an image without an apk offers nothing", func(t *testing.T) {
		if serverWithBundle(t, true, t.TempDir()).androidApp().Available {
			t.Error("want unavailable")
		}
	})
}

func TestAndroidDownloadServesTheAPK(t *testing.T) {
	const body = "pretend apk bytes"
	dir := bundleDir(t, goodMeta, "activity-lens-1.4.2-release.apk", body)
	s := serverWithBundle(t, true, dir)

	rec := httptest.NewRecorder()
	s.handleAndroidDownload(rec, httptest.NewRequest("GET", "/api/app/android/download", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Body.String() != body {
		t.Errorf("body = %q, want the apk's contents", rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/vnd.android.package-archive" {
		t.Errorf("Content-Type = %q; Android will not install what it is not told is an APK", ct)
	}
	// The filename carries the version, which is how someone with several APKs
	// in a downloads folder can tell them apart.
	if cd := rec.Header().Get("Content-Disposition"); cd == "" {
		t.Error("no Content-Disposition, so the download is named after the URL")
	}
}

// Range support is what lets an interrupted download on a phone resume rather
// than start over, and comes from serving the file properly rather than copying
// bytes by hand.
func TestAndroidDownloadSupportsRanges(t *testing.T) {
	const body = "0123456789"
	dir := bundleDir(t, goodMeta, "activity-lens-1.4.2-release.apk", body)
	s := serverWithBundle(t, true, dir)

	r := httptest.NewRequest("GET", "/api/app/android/download", nil)
	r.Header.Set("Range", "bytes=4-6")
	rec := httptest.NewRecorder()
	s.handleAndroidDownload(rec, r)

	if rec.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", rec.Code)
	}
	if rec.Body.String() != "456" {
		t.Errorf("body = %q, want the requested range", rec.Body.String())
	}
}

func TestAndroidDownloadWhenUnavailable(t *testing.T) {
	full := bundleDir(t, goodMeta, "activity-lens-1.4.2-release.apk", "x")
	for name, s := range map[string]*Server{
		"disabled":  serverWithBundle(t, false, full),
		"no bundle": serverWithBundle(t, true, t.TempDir()),
	} {
		t.Run(name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			s.handleAndroidDownload(rec, httptest.NewRequest("GET", "/api/app/android/download", nil))
			if rec.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404", rec.Code)
			}
		})
	}
}
