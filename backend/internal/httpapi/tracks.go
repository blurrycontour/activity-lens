package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// The overview map: every workout at once, as simplified routes.

// maxTracks caps one response.
//
// A cap rather than paging, because a map is not a list: the answer to "too
// many to draw" is to zoom in or narrow the dates, not to fetch page two and
// draw it on top. The client is told when it was capped so it can say so.
const maxTracks = 2000

// handleWorkoutTracks returns the routes visible in a viewport and date range.
//
// The filtering happens in SQL against the denormalised bounding boxes, so
// panning a map never decompresses a route — which is the entire reason those
// columns exist. See workout.ListTracks.
func (s *Server) handleWorkoutTracks(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	q := workout.TrackQuery{Limit: maxTracks}

	// "minLat,minLon,maxLat,maxLon". Absent on the first load, which has not
	// been told where to look yet and wants whatever there is.
	if raw := r.URL.Query().Get("bbox"); raw != "" {
		parts := strings.Split(raw, ",")
		if len(parts) != 4 {
			writeError(w, http.StatusBadRequest, "bbox must be minLat,minLon,maxLat,maxLon")
			return
		}
		var v [4]float64
		for i, p := range parts {
			f, err := strconv.ParseFloat(strings.TrimSpace(p), 64)
			if err != nil {
				writeError(w, http.StatusBadRequest, "bbox must be four numbers")
				return
			}
			v[i] = f
		}
		q.Box = workout.Bounds{MinLat: v[0], MinLon: v[1], MaxLat: v[2], MaxLon: v[3]}
	}
	if from, ok := parseDayParam(w, r, "from"); !ok {
		return
	} else if !from.IsZero() {
		q.From = from
	}
	if to, ok := parseDayParam(w, r, "to"); !ok {
		return
	} else if !to.IsZero() {
		// Inclusive of the whole day, so "to=2025-07-12" includes that day's
		// workouts rather than only the ones at midnight.
		q.To = to.Add(24*time.Hour - time.Second)
	}

	tracks, err := s.workout.Tracks(r.Context(), user.ID, q)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read tracks")
		return
	}
	// How many are still being prepared, so the map can say "still working"
	// rather than presenting a partial library as the whole of it.
	preparing, err := s.workout.TracksPending(r.Context(), user.ID)
	if err != nil {
		preparing = 0
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tracks":    tracks,
		"capped":    len(tracks) >= maxTracks,
		"preparing": preparing,
	})
}

// parseDayParam reads a YYYY-MM-DD query parameter. Reports ok=false only when
// one was given and could not be read — absent is not an error.
func parseDayParam(w http.ResponseWriter, r *http.Request, name string) (time.Time, bool) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return time.Time{}, true
	}
	t, err := time.Parse("2006-01-02", raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, name+" must be YYYY-MM-DD")
		return time.Time{}, false
	}
	return t.UTC(), true
}
