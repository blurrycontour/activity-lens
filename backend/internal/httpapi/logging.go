package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// statusRecorder captures the status code and response size for the access log,
// since http.ResponseWriter exposes neither after the fact.
type statusRecorder struct {
	http.ResponseWriter
	status int
	bytes  int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func (r *statusRecorder) Write(b []byte) (int, error) {
	// A handler that writes without calling WriteHeader implies 200.
	if r.status == 0 {
		r.status = http.StatusOK
	}
	n, err := r.ResponseWriter.Write(b)
	r.bytes += n
	return n, err
}

// withAccessLog logs one line per API request. Severity follows the status
// code, so a 5xx stands out in `docker compose logs` without having to raise
// the global log level.
//
// Only /api is wrapped: static asset requests are numerous, uninteresting, and
// would drown the events that matter.
func withAccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		rec := &statusRecorder{ResponseWriter: w}
		next.ServeHTTP(rec, r)

		if rec.status == 0 {
			rec.status = http.StatusOK
		}
		attrs := []any{
			"method", r.Method,
			"path", r.URL.Path,
			"status", rec.status,
			"duration_ms", time.Since(started).Milliseconds(),
			"ip", clientIP(r),
		}
		// Present only once RequireAuth has resolved the session.
		if u := httpmw.UserFrom(r); u != nil {
			attrs = append(attrs, "user", u.Username)
		}

		switch {
		case rec.status >= 500:
			slog.Error("request failed", attrs...)
		case rec.status >= 400:
			slog.Warn("request rejected", attrs...)
		default:
			slog.Info("request", attrs...)
		}
	})
}
