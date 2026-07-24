// Package httpapi wires the domain services (auth via go-authkit, workouts)
// into a net/http server: JSON REST endpoints under /api plus the embedded SPA.
package httpapi

import (
	"encoding/json"
	"errors"
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

// decodeJSON reads and validates a JSON request body into v.
func decodeJSON(r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(nil, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errors.New("invalid request body")
	}
	return nil
}
