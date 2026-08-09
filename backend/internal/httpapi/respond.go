// Package httpapi wires the domain services (auth via go-authkit, workouts)
// into a net/http server: JSON REST endpoints under /api plus the embedded SPA.
package httpapi

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
)

// writeJSON serializes v as JSON with the given status code.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("encode json response", "error", err)
	}
}

// errorBody is the standard error envelope returned to clients.
type errorBody struct {
	Error string `json:"error"`
}

// writeError writes a JSON error envelope.
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, errorBody{Error: msg})
}

// decodeJSON reads and validates a JSON request body into v, rejecting fields
// the target does not name.
func decodeJSON(r *http.Request, v any) error {
	return decode(r, v, true)
}

// decodeJSONLenient reads a JSON request body into v, ignoring fields it does
// not know rather than failing the request.
//
// For endpoints that take a whole record back the way they handed it out. Those
// are read and re-sent by clients that ship on their own schedule — an Android
// APK installed months ago, a PWA holding a cached service worker — and a
// strict decoder turns "this client is a version behind" into "every save
// fails", including for settings that have not changed in years.
//
// The thing strictness was protecting against is the opposite mistake: a field
// the server *emits* and cannot read back. That is a server bug, it is caught
// by the contract tests in preferences_test.go, and CI is where it should be
// caught — not at runtime, on a user, on a field they never touched.
func decodeJSONLenient(r *http.Request, v any) error {
	return decode(r, v, false)
}

func decode(r *http.Request, v any, strict bool) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	if strict {
		dec.DisallowUnknownFields()
	}
	if err := dec.Decode(v); err != nil {
		// The reason is included. It names a field or a type from the caller's
		// own body and nothing about the server, and without it a rejected save
		// is undiagnosable from the outside — which cost a release to work out
		// once already.
		return fmt.Errorf("invalid request body: %w", err)
	}
	return nil
}
