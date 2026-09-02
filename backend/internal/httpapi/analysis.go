package httpapi

import (
	"net/http"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// handleHRZonesSummary returns per-workout heart-rate zone sample counts for the
// whole library.
//
// The Analysis page fetches this once and does its own date/type filtering on
// the client, so switching filters or ranges never calls the server. The counts
// are computed against the athlete's own ceiling and model, exactly as each
// workout's own zones chart is.
func (s *Server) handleHRZonesSummary(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	zs, err := s.settings.AthleteHRZoneSettings(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read zone settings")
		return
	}
	counts, err := s.workout.HRZoneCounts(r.Context(), user.ID, zs.MaxHR, zs.RestingHR, zs.Method)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not summarise heart-rate zones")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"zones": counts})
}
