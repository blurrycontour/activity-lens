package httpapi

import (
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/imageutil"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

// The workout gallery.
//
// Two permission levels, and they are not the same one:
//
//   - reading a photo needs only that the user may see the workout, so a photo
//     travels with a share exactly as the route and the charts do;
//   - adding or removing one needs ownership.
//
// Both are decided here rather than in the store, so there is one place to read
// them, and both start from a repository call that already fails closed —
// GetViewable and Get return ErrNotFound rather than a permission error for a
// workout the caller may not have.

// A photo is bounded by maxUploadBytes, shared with the activity-file import —
// generous against what the client sends, since the browser downscales before
// upload, and there as the backstop for a client that did not.

// mediaCacheSeconds is how long a photo may be held.
//
// Long, and safely so: a photo's id is random and its bytes never change, so a
// stale copy is impossible. Private, because a workout can be unshared and the
// next request must ask again rather than be served from a proxy.
const mediaCacheSeconds = 86400

// handleListMedia returns the gallery for a workout the user may see.
func (s *Server) handleListMedia(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	wk, _, err := s.workout.GetViewable(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	items, err := s.workout.Photos(r.Context(), wk.ID)
	if err != nil {
		slog.Error("could not list workout media", "workout_id", wk.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the gallery")
		return
	}
	// Never null: the client renders this straight into a grid, and a null
	// would be one more thing for every caller to guard.
	if items == nil {
		items = []workout.Media{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"media": items, "max": workout.MaxMediaPerWorkout})
}

// handleServeMedia streams one photo, or its thumbnail with ?thumb=1.
func (s *Server) handleServeMedia(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	wk, _, err := s.workout.GetViewable(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	// Through the row rather than straight to the path, so an id belonging to
	// another workout is a 404 here instead of a file read.
	m, err := s.workout.Photo(r.Context(), wk.ID, r.PathValue("mediaID"))
	if errors.Is(err, workout.ErrMediaNotFound) {
		writeError(w, http.StatusNotFound, "no such photo")
		return
	}
	if err != nil {
		slog.Error("could not read media row", "workout_id", wk.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "could not load the photo")
		return
	}

	thumb := r.URL.Query().Get("thumb") == "1"
	path := s.media.Path(wk.ID, m.ID, thumb)
	f, err := os.Open(path)
	if err != nil {
		// The row exists and the file does not. Worth a log line: it means the
		// database and the disk have diverged, which nothing else would notice.
		slog.Warn("media file is missing", "workout_id", wk.ID, "media_id", m.ID, "error", err)
		writeError(w, http.StatusNotFound, "no such photo")
		return
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		writeError(w, http.StatusNotFound, "no such photo")
		return
	}
	w.Header().Set("Content-Type", m.MIME)
	w.Header().Set("Cache-Control", fmt.Sprintf("private, max-age=%d, immutable", mediaCacheSeconds))
	// ServeContent and not io.Copy: it handles conditional requests and range
	// requests, so a reload costs a 304 and nothing is buffered in memory.
	http.ServeContent(w, r, m.ID+".jpg", info.ModTime(), f)
}

// handleUploadMedia stores one photo against a workout the user owns.
//
// The order is: check, process, write the file, then insert the row — and undo
// the file if the insert fails. The other order leaves a row pointing at
// nothing, which is a gallery tile that never loads; this one can at worst
// leave a file nothing points at, which is invisible and reclaimed when the
// workout is deleted.
func (s *Server) handleUploadMedia(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	// Get and not GetViewable: adding to someone else's gallery is a different
	// feature with a different consent story, and this is not it.
	wk, err := s.workout.Get(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}

	count, err := s.workout.PhotoCount(r.Context(), wk.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not read the gallery")
		return
	}
	if count >= workout.MaxMediaPerWorkout {
		writeError(w, http.StatusConflict,
			fmt.Sprintf("this workout already has the maximum of %d photos", workout.MaxMediaPerWorkout))
		return
	}

	// Bounded before parsing, so an oversized body is refused rather than read.
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("that file is too large — the limit is %d MB", maxUploadBytes>>20))
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "no file was sent")
		return
	}
	defer file.Close()

	// One byte past the limit, so a file that is exactly at it is accepted and
	// one over is caught here rather than silently truncated.
	raw, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil || len(raw) > maxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge,
			fmt.Sprintf("that file is too large — the limit is %d MB", maxUploadBytes>>20))
		return
	}

	full, thumb, pw, ph, err := imageutil.ProcessPhoto(raw)
	if err != nil {
		// Deliberately not the decoder's message: it names internal formats and
		// says nothing the person who picked the file can act on.
		writeError(w, http.StatusBadRequest, "that file is not an image this can read")
		return
	}

	id, err := s.workout.NewPhotoID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not store the photo")
		return
	}
	if err := s.media.Save(wk.ID, id, full, thumb); err != nil {
		slog.Error("could not write media", "workout_id", wk.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "could not store the photo")
		return
	}

	saved, err := s.workout.AddPhoto(r.Context(), workout.Media{
		ID:        id,
		WorkoutID: wk.ID,
		UserID:    user.ID,
		Kind:      "photo",
		Filename:  cleanUploadName(header.Filename),
		MIME:      "image/jpeg",
		Width:     pw,
		Height:    ph,
		Bytes:     int64(len(full)),
		Caption:   strings.TrimSpace(r.FormValue("caption")),
		CreatedAt: time.Now().UTC(),
	})
	if err != nil {
		s.media.Remove(wk.ID, id)
		slog.Error("could not record media", "workout_id", wk.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "could not store the photo")
		return
	}
	// After the row is stored, so nobody is told about a photo that failed to
	// record. Only the people this workout was shared with directly hear about
	// it; see notifyPhotoAdded.
	s.notifyPhotoAdded(r, *user, wk)

	writeJSON(w, http.StatusCreated, saved)
}

// handleDeleteMedia removes one photo from a workout the user owns.
//
// The row goes first and the file after it. If the process dies in between, the
// result is an unreferenced file — wasted bytes nobody sees — where the other
// order would leave a row whose tile is permanently broken.
func (s *Server) handleDeleteMedia(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	wk, err := s.workout.Get(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	mediaID := r.PathValue("mediaID")
	if err := s.workout.RemovePhoto(r.Context(), wk.ID, mediaID); err != nil {
		if errors.Is(err, workout.ErrMediaNotFound) {
			writeError(w, http.StatusNotFound, "no such photo")
			return
		}
		slog.Error("could not delete media row", "workout_id", wk.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "could not delete the photo")
		return
	}
	s.media.Remove(wk.ID, mediaID)
	w.WriteHeader(http.StatusNoContent)
}

// cleanUploadName keeps the uploaded filename usable as a label.
//
// It is never part of a path — files are named by media id — so this only has
// to stop it being an unreadable mess in the UI.
func cleanUploadName(name string) string {
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	name = strings.TrimSpace(name)
	if len(name) > 120 {
		name = name[:120]
	}
	return name
}
