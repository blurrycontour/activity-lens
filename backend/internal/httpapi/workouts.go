package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/ingest"
	"github.com/blurrycontour/activity-lens/backend/internal/notify"
	"github.com/blurrycontour/activity-lens/backend/internal/settings"
	"github.com/blurrycontour/activity-lens/backend/internal/workout"

	"github.com/blurrycontour/go-authkit/httpmw"
)

const maxUploadBytes = 25 << 20 // 25 MiB

// handleListWorkouts returns the caller's own library — never anyone else's.
// The dashboard, stats and consistency views all assume that.
func (s *Server) handleListWorkouts(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	list, err := s.workout.ListSummary(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load workouts")
		return
	}
	// One grouped query annotates the whole library, so the list can badge
	// shared workouts without a per-row lookup.
	if counts, err := s.workout.ShareCounts(r.Context(), user.ID); err == nil {
		for i := range list {
			list[i].SharedWithCount = counts[list[i].ID]
		}
	} else {
		slog.Warn("could not load share counts", "error", err)
	}
	writeJSON(w, http.StatusOK, list)
}

// workoutDetailResponse wraps a workout with whether the caller owns it, so the
// client knows to offer edit controls. It is a response concern, not a domain
// one, which is why it does not live on workout.Workout.
type workoutDetailResponse struct {
	*workout.Workout
	IsOwner bool `json:"isOwner"`
	// HasOriginal reports that the file this workout was imported from was
	// archived and can be downloaded. A boolean rather than the filename: the
	// client only needs to know whether to offer the action, and the name is
	// sent with the file itself. Owner-only, so Redact clearing RawFilename is
	// enough to keep it false for everyone else.
	HasOriginal bool `json:"hasOriginal,omitempty"`
	// Shared reports that this workout is visible to someone other than its
	// owner — public, or shared with at least one person. It is what decides
	// whether the Social tab is offered, and it has to arrive with the workout
	// rather than with the tab's own request: a tab that appears only after
	// its contents load is a tab that flickers into existence on every page.
	//
	// One EXISTS query, and only on the detail path. Deliberately not added to
	// the list response, which would turn it into a per-row lookup across the
	// whole library for something no list shows.
	Shared bool `json:"shared,omitempty"`
}

func (s *Server) handleGetWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	wk, isOwner, err := s.workout.GetViewable(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	// Anyone who is not the owner is looking at this workout because it is
	// shared, so the flag is theirs for free; only the owner needs the query.
	shared := true
	if isOwner {
		s.attachEquipment(r, user.ID, wk)
		var serr error
		if shared, serr = s.workout.IsShared(r.Context(), user.ID, wk.ID); serr != nil {
			// Not fatal: the workout is the point of this response, and a
			// missing Social tab is a smaller failure than no page at all.
			slog.Warn("could not check workout sharing", "workout_id", wk.ID, "error", serr)
			shared = false
		}
	} else if owner, derr := s.ownerRef(r, wk.UserID); derr == nil {
		// Equipment is deliberately left off: it is the owner's private gear
		// inventory, not part of the workout being shared.
		wk.Owner = owner
	}
	writeJSON(w, http.StatusOK, workoutDetailResponse{
		Workout: wk, IsOwner: isOwner, HasOriginal: wk.RawFilename != "", Shared: shared,
	})
}

// handleDownloadOriginal streams back the exact file a workout was imported
// from. The GPX the client can already build from the parsed timelines is a
// re-serialization: device extensions, the original timestamps and anything the
// parser did not model are not in it. This is the unmodified bytes, which is
// what someone moving their history elsewhere actually needs.
//
// Owner-only, deliberately: a shared or public workout shows the track, but the
// source file can carry more than the owner chose to share — device serial
// numbers, software versions, extension fields nothing renders. Get returns
// ErrNotFound for anyone else, so this needs no separate ownership check.
func (s *Server) handleDownloadOriginal(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	wk, err := s.workout.Get(r.Context(), user.ID, r.PathValue("id"))
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	if s.rawUploads == nil {
		writeError(w, http.StatusNotFound, "no original file was archived for this workout")
		return
	}
	data, err := s.rawUploads.Open(r.Context(), wk.ID, wk.RawFilename)
	if errors.Is(err, workout.ErrNoRawUpload) {
		writeError(w, http.StatusNotFound, "no original file was archived for this workout")
		return
	}
	if err != nil {
		slog.Error("could not read archived upload", "workout_id", wk.ID, "error", err)
		writeError(w, http.StatusInternalServerError, "could not read the original file")
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.Header().Set("Content-Disposition", contentDisposition(wk.RawFilename))
	// The archive never changes once written, so a client that already has it
	// need not fetch it twice. Private: it is one user's file.
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if _, err := w.Write(data); err != nil {
		slog.Warn("could not write archived upload", "workout_id", wk.ID, "error", err)
	}
}

// contentDisposition builds an attachment header for a user-supplied filename.
// The name is quoted with the RFC 5987 form alongside it so non-ASCII survives,
// and stripped of anything that could break out of the header or the browser's
// download directory — it originally came from an upload form, so it is not
// trusted here even though Save only ever used its extension.
func contentDisposition(filename string) string {
	// Both separators, explicitly: filepath.Base only knows the running OS's,
	// so on Linux it would leave "C:\dir\file.gpx" whole — and some clients do
	// send a full Windows path as the multipart filename.
	name := filename
	if i := strings.LastIndexAny(name, `/\`); i >= 0 {
		name = name[i+1:]
	}
	ascii := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '"' || r == '\\' || r > 0x7e {
			return '_'
		}
		return r
	}, name)
	if ascii == "" || ascii == "." || ascii == ".." {
		ascii = "workout"
	}
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, ascii, url.PathEscape(name))
}

// createWorkoutRequest is the manual-entry payload from the import modal.
type createWorkoutRequest struct {
	Name          string   `json:"name"`
	Type          string   `json:"type"`
	Date          string   `json:"date"` // YYYY-MM-DD
	Duration      int      `json:"duration"`
	Distance      float64  `json:"distance"`
	AvgHR         int      `json:"avgHR"`
	MaxHR         int      `json:"maxHR"`
	ElevationGain float64  `json:"elevationGain"`
	Calories      int      `json:"calories"`
	Notes         string   `json:"notes"`
	EquipmentIDs  []string `json:"equipmentIds"`
}

func (s *Server) handleCreateWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req createWorkoutRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	start := time.Now().UTC()
	if req.Date != "" {
		if t, err := time.Parse("2006-01-02", req.Date); err == nil {
			start = t.UTC()
		}
	}
	in := workout.Input{
		Name:          req.Name,
		Type:          workout.Type(req.Type),
		StartTime:     start,
		Duration:      req.Duration,
		Distance:      req.Distance,
		AvgHR:         req.AvgHR,
		MaxHR:         req.MaxHR,
		ElevationGain: req.ElevationGain,
		Calories:      req.Calories,
		Notes:         req.Notes,
		Source:        workout.SourceManual,
	}
	if prefs, err := s.settings.UserPreferences(r.Context(), user.ID); err == nil {
		in.StepLengthM = stepLengthMeters(prefs)
	}
	wk, err := s.workout.Create(r.Context(), user.ID, in)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	s.linkEquipment(r, user.ID, wk, req.EquipmentIDs)
	slog.Info("workout created", "workout_id", wk.ID, "user_id", user.ID, "source", "manual")
	s.afterWorkoutRecorded(r, user.ID)
	writeJSON(w, http.StatusCreated, wk)
}

func (s *Server) handlePatchWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Name         *string   `json:"name"`
		Type         *string   `json:"type"`
		Notes        *string   `json:"notes"`
		Date         *string   `json:"date"` // YYYY-MM-DD
		Calories     *int      `json:"calories"`
		Steps        *int      `json:"steps"`
		Distance     *float64  `json:"distance"` // metres
		EquipmentIDs *[]string `json:"equipmentIds"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	patch := workout.Patch{
		Name: req.Name, Notes: req.Notes, Calories: req.Calories, Steps: req.Steps,
		Distance: req.Distance,
	}
	// Only for a distance edit, which is what re-derives the step estimate.
	// Every other field leaves it alone, and this is a query per request.
	if req.Distance != nil {
		if prefs, err := s.settings.UserPreferences(r.Context(), user.ID); err == nil {
			patch.StepLengthM = stepLengthMeters(prefs)
		}
	}
	if req.Type != nil {
		t := workout.Type(*req.Type)
		patch.Type = &t
	}
	if req.Date != nil {
		t, err := time.Parse("2006-01-02", *req.Date)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid date")
			return
		}
		patch.StartTime = &t
	}
	wk, err := s.workout.Update(r.Context(), user.ID, r.PathValue("id"), patch)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	if req.EquipmentIDs != nil {
		if err := s.equipment.SetForWorkout(r.Context(), user.ID, wk.ID, *req.EquipmentIDs); err != nil {
			slog.Warn("could not set workout equipment", "workout_id", wk.ID, "error", err)
		}
	}
	s.attachEquipment(r, user.ID, wk)
	// The client splices this response back into its cached list, so the share
	// count has to come along or an unrelated edit would blank the row's badge.
	if ids, err := s.workout.ShareRecipients(r.Context(), user.ID, wk.ID); err == nil {
		wk.SharedWithCount = len(ids)
	}
	slog.Info("workout updated", "workout_id", wk.ID, "user_id", user.ID)
	writeJSON(w, http.StatusOK, wk)
}

// linkEquipment associates the given equipment ids with a workout (best-effort;
// failures are logged) and attaches the resulting equipment to the workout.
func (s *Server) linkEquipment(r *http.Request, userID int64, wk *workout.Workout, ids []string) {
	if len(ids) > 0 {
		if err := s.equipment.SetForWorkout(r.Context(), userID, wk.ID, ids); err != nil {
			slog.Warn("could not set workout equipment", "workout_id", wk.ID, "error", err)
		}
	}
	s.attachEquipment(r, userID, wk)
}

func (s *Server) handleDeleteWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	id := r.PathValue("id")
	if err := s.workout.Delete(r.Context(), user.ID, id); err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	// The archived upload is part of the workout, so it goes too. Best-effort
	// and logged rather than fatal: the workout row is already gone, and
	// failing the response over a leftover file would be worse than the leak.
	if err := s.rawUploads.Delete(r.Context(), id); err != nil {
		slog.Warn("could not delete archived upload", "workout_id", id, "error", err)
	}
	// So are its photos. The rows went with the workout through the foreign
	// key; the files are ours to remove, and the whole directory is one call.
	s.media.RemoveWorkout(id)
	slog.Info("workout deleted", "workout_id", id, "user_id", user.ID)
	w.WriteHeader(http.StatusNoContent)
}

// importResponse is a workout plus a flag telling the client this file had
// already been imported. The workout is embedded so its fields stay at the top
// level of the JSON object and existing clients are unaffected.
type importResponse struct {
	*workout.Workout
	Duplicate bool `json:"duplicate,omitempty"`
}

func (s *Server) handleImportWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	in, data, header, ok := s.parseWorkoutUpload(w, r, user.ID)
	if !ok {
		return
	}

	wk, created, err := s.workout.CreateIdempotent(r.Context(), user.ID, in)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	// An already-imported file resolves to the stored workout as-is: re-linking
	// equipment would clobber edits the user has since made to it, and the
	// original bytes are already archived.
	if !created {
		s.attachEquipment(r, user.ID, wk)
		slog.Info("workout import skipped (duplicate)", "workout_id", wk.ID, "user_id", user.ID, "filename", header.Filename)
		writeJSON(w, http.StatusOK, importResponse{Workout: wk, Duplicate: true})
		return
	}
	var equipmentIDs []string
	if r.MultipartForm != nil {
		equipmentIDs = r.MultipartForm.Value["equipmentIds"]
	}
	s.linkEquipment(r, user.ID, wk, equipmentIDs)
	slog.Info("workout imported", "workout_id", wk.ID, "user_id", user.ID, "filename", header.Filename, "bytes", len(data))
	// Gear and goal checks re-read the whole library, so running them per file
	// makes a bulk import quadratic. A batching client sets deferChecks and
	// calls /api/workouts/import/finalize once at the end instead.
	if !formBool(r, "deferChecks") {
		s.afterWorkoutRecorded(r, user.ID)
	}

	if s.rawUploads != nil {
		if keep, err := s.settings.StoredStorage(r.Context()); err == nil && keep.KeepOriginalUploads {
			contentType := header.Header.Get("Content-Type")
			if contentType == "" {
				contentType = "application/octet-stream"
			}
			if err := s.rawUploads.Save(r.Context(), wk.ID, header.Filename, contentType, data); err != nil {
				slog.Warn("could not save original upload", "workout_id", wk.ID, "error", err)
			} else if err := s.workout.RecordRawFilename(r.Context(), wk.ID, header.Filename); err != nil {
				// Only recorded once the file is safely on disk, so the column
				// never promises a download that is not there. The reverse — a
				// file with no column — costs a little disk and is cleaned up
				// with the workout either way, since deletes sweep by id.
				slog.Warn("could not record original upload filename", "workout_id", wk.ID, "error", err)
			} else {
				wk.RawFilename = header.Filename
			}
		}
	}

	writeJSON(w, http.StatusCreated, importResponse{Workout: wk})
}

// formBool reads a multipart form value as a boolean. Absent, "", "0" and
// "false" are all false, so a client that omits the field behaves exactly as
// before it existed.
func formBool(r *http.Request, name string) bool {
	switch strings.ToLower(strings.TrimSpace(r.FormValue(name))) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

// handleKnownImports reports which of the supplied content hashes the caller
// has already imported.
//
// Uploading a known file is harmless — imports are content-addressed, so it
// resolves to the stored workout — but it costs a full upload and parse each
// time. One round trip for a whole batch is what keeps re-importing an export
// archive, or re-scanning a folder, from re-uploading everything.
//
// The hashes are the client's own SHA-256 of the file bytes, the same value
// parseWorkoutUpload derives server-side, so the two agree by construction.
func (s *Server) handleKnownImports(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req struct {
		Hashes []string `json:"hashes"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	known, err := s.workout.KnownContentHashes(r.Context(), user.ID, req.Hashes)
	if err != nil {
		if errors.Is(err, workout.ErrInvalid) {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "could not check imported files")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"known": known})
}

// handleFinalizeImport runs the post-import checks a batch deferred.
//
// Importing a file normally triggers a gear-wear and goal evaluation, each of
// which reads the user's entire library. That is fine once, and quadratic
// across a few hundred files, so a bulk import skips them per file and calls
// this at the end. Notifications are deduped by key, so one evaluation for the
// batch produces the same notifications the per-file version would have.
//
// Safe to call with no preceding import, and safe to call twice — the checks
// are pure reads plus deduped notifications, so this needs no batch identity.
// It also carries the one notification a batch can produce about itself. An
// auto-import from the Android app's watched folder happens with nobody looking,
// so it says what it did; a manual import sends no count and stays silent,
// because the user is already watching the progress bar.
func (s *Server) handleFinalizeImport(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	s.afterWorkoutRecorded(r, user.ID)

	// The body is optional: this endpoint predates it, and a client that sends
	// nothing must keep working.
	var req struct {
		// Imported is how many workouts an unattended batch actually created.
		Imported int `json:"imported"`
		// Folder names where they came from, for the notification text.
		Folder string `json:"folder"`
	}
	if err := decodeJSON(r, &req); err == nil && req.Imported > 0 {
		s.notifyAutoImported(r, user.ID, req.Imported, req.Folder)
	}
	w.WriteHeader(http.StatusNoContent)
}

// autoImportLink points at the workouts this batch brought in.
//
// Straight to those, not the whole library: being shown everything and told
// three of them are new is not an answer to "which three". A timestamp rather
// than a list of ids, so the link stays short however many files a scan found.
//
// Closed at both ends. A notification outlives the moment it describes: open it
// a day later, after the folder watch has run twice more, and an open-ended
// window would have grown to cover those imports too — so "3 workouts imported"
// would land on a list of seven, still captioned as the batch.
//
// Zero times mean "no window", and the link falls back to every auto-import.
// That is the honest answer when the batch cannot be located — imprecise, but a
// filter that matches nothing would be worse.
func autoImportLink(since, until time.Time) string {
	link := "/workouts?source=autoimport"
	if since.IsZero() || until.IsZero() {
		return link
	}
	link += "&since=" + url.QueryEscape(since.UTC().Format(time.RFC3339))
	link += "&until=" + url.QueryEscape(until.UTC().Format(time.RFC3339))
	return link
}

// notifyAutoImported reports an unattended import.
//
// Not deduped: two folder scans that both find files are two separate events,
// and collapsing them would silently drop the second. The dedupe keys elsewhere
// exist for *standing conditions* — a worn-out shoe is still worn out tomorrow —
// which this is not.
func (s *Server) notifyAutoImported(r *http.Request, userID int64, count int, folder string) {
	if s.notify == nil {
		return
	}
	// Where the batch begins, read from the library rather than reported by the
	// device that imported it. See ImportWindow: asking the client means
	// trusting its clock and its version, and both fail silently.
	since, until, err := s.workout.ImportWindow(r.Context(), userID, workout.SourceAutoImport, count)
	if err != nil {
		slog.Warn("could not resolve the auto-import window", "user_id", userID, "error", err)
	}
	title := "1 workout imported"
	if count > 1 {
		title = fmt.Sprintf("%d workouts imported", count)
	}
	body := "Found in your watched folder"
	if folder != "" {
		body = "Found in " + folder
	}
	s.notify.Notify(r.Context(), notify.Event{
		UserID: userID,
		Kind:   notify.KindWorkoutImported,
		Title:  title,
		Body:   body,
		Link:   autoImportLink(since, until),
	})
}

// handlePreviewWorkout parses an uploaded file and returns the derived metrics
// without persisting anything, so the client can show the numbers before the
// user commits to saving the workout.
func (s *Server) handlePreviewWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	in, _, _, ok := s.parseWorkoutUpload(w, r, user.ID)
	if !ok {
		return
	}
	wk, err := s.workout.Preview(in)
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	// Whether importing this would create anything, answered before committing.
	// Reuses the identity parseWorkoutUpload already derived, so a batch can
	// show "already imported" alongside the parsed numbers. A lookup failure
	// only costs the flag — the preview itself is still worth returning.
	duplicate := false
	if in.ExternalID != "" {
		if _, err := s.workout.GetBySourceID(r.Context(), user.ID, in.Source, in.ExternalID); err == nil {
			duplicate = true
		}
	}
	writeJSON(w, http.StatusOK, importResponse{Workout: wk, Duplicate: duplicate})
}

// parseWorkoutUpload reads a multipart file upload, parses it into a workout
// Input, applies an optional name override, and fills in an estimated calorie
// value from the user's preferences when the file has none. On any failure it
// writes an error response and returns ok=false.
func (s *Server) parseWorkoutUpload(w http.ResponseWriter, r *http.Request, userID int64) (workout.Input, []byte, *multipart.FileHeader, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes)
	if err := r.ParseMultipartForm(maxUploadBytes); err != nil {
		writeError(w, http.StatusBadRequest, "could not read upload")
		return workout.Input{}, nil, nil, false
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "missing file field")
		return workout.Input{}, nil, nil, false
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		writeError(w, http.StatusBadRequest, "could not read file")
		return workout.Input{}, nil, nil, false
	}

	// A type sent with the upload is the user's own answer, chosen in the import
	// window, so it outranks the file: someone who picks Hike for a TCX that
	// declares Running has looked at both and disagrees, and overruling them
	// would leave them editing the workout afterwards — the exact trip this is
	// meant to save.
	//
	// Absent, the file decides, and Other is where it lands when the file
	// declares no sport and its free text names none. Not Run: claiming such a
	// workout is a run is a guess nothing on screen can reveal as wrong.
	chosen := workout.Type(r.FormValue("type"))
	if !workout.ValidType(chosen) || chosen == workout.TypeOther {
		chosen = ""
	}

	in, err := ingest.Parse(header.Filename, data, workout.TypeOther)
	if err != nil {
		if errors.Is(err, ingest.ErrUnsupported) {
			writeError(w, http.StatusUnsupportedMediaType, "unsupported file format (use .gpx or .tcx)")
			return workout.Input{}, nil, nil, false
		}
		writeError(w, http.StatusBadRequest, "could not parse file: "+err.Error())
		return workout.Input{}, nil, nil, false
	}
	if chosen != "" {
		in.Type = chosen
	}
	if name := r.FormValue("name"); name != "" {
		in.Name = name
	}
	// Identify the upload by its content so re-importing the same file (a
	// repeated share from a tracker app, a double-click on Import) resolves to
	// the workout already stored rather than creating a second copy.
	sum := sha256.Sum256(data)
	in.Source = workout.SourceUpload
	// The Android folder watch says so, because nothing else can tell: the
	// request is otherwise identical to a file the user picked by hand, and how a
	// workout arrived is worth keeping.
	if claimed := workout.Source(r.FormValue("source")); workout.ValidSource(claimed) {
		in.Source = claimed
	}
	in.ContentHash = hex.EncodeToString(sum[:])
	in.ExternalID = in.ContentHash
	if prefs, err := s.settings.UserPreferences(r.Context(), userID); err == nil {
		in.StepLengthM = stepLengthMeters(prefs)
		if in.Calories == 0 {
			in.Calories = estimateCalories(in, prefs)
		}
	}
	return in, data, header, true
}

func estimateCalories(in workout.Input, prefs settings.UserPrefs) int {
	return workout.EstimateCalories(in.Type, in.Duration, in.AvgHR, in.Distance, prefs.BodyWeightKg, ageFromPrefs(prefs), prefs.Sex, prefs.CalorieMethod)
}

// stepLengthMeters converts a user's stored stride length (cm) to metres, or 0
// when unset so the workout service falls back to per-activity defaults.
func stepLengthMeters(prefs settings.UserPrefs) float64 {
	if prefs.StepLengthCm <= 0 {
		return 0
	}
	return float64(prefs.StepLengthCm) / 100
}

// clampStepLength keeps a user-supplied stride length within a plausible human
// range (cm); anything outside it is treated as unset (0 = activity default).
func clampStepLength(cm int) int {
	if cm < 30 || cm > 200 {
		return 0
	}
	return cm
}

// ageFromPrefs returns the user's age derived from their birth year, or 0 when
// no birth year has been set.
func ageFromPrefs(prefs settings.UserPrefs) int {
	if prefs.BirthYear <= 0 {
		return 0
	}
	age := time.Now().UTC().Year() - prefs.BirthYear
	if age < 0 || age > 120 {
		return 0
	}
	return age
}

// recalcPartsFrom reads the selection from the request body.
//
// An absent or empty body means everything, which is what every client sent
// before the selection existed and what a bare "recalculate" still means.
func recalcPartsFrom(r *http.Request) (workout.RecalcParts, error) {
	var body struct {
		HeartRate *bool `json:"heartRate"`
		Elevation *bool `json:"elevation"`
		Pauses    *bool `json:"pauses"`
		PaceSpeed *bool `json:"paceSpeed"`
		Steps     *bool `json:"steps"`
		Calories  *bool `json:"calories"`
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		if errors.Is(err, io.EOF) {
			return workout.AllRecalcParts(), nil
		}
		return workout.RecalcParts{}, errors.New("invalid request body")
	}
	on := func(p *bool) bool { return p != nil && *p }
	parts := workout.RecalcParts{
		HeartRate: on(body.HeartRate),
		Elevation: on(body.Elevation),
		Pauses:    on(body.Pauses),
		PaceSpeed: on(body.PaceSpeed),
		Steps:     on(body.Steps),
		Calories:  on(body.Calories),
	}
	if !parts.Any() {
		return workout.RecalcParts{}, errors.New("select at least one value to recalculate")
	}
	return parts, nil
}

func (s *Server) handleRecalculateWorkout(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	prefs, err := s.settings.UserPreferences(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load preferences")
		return
	}
	parts, err := recalcPartsFrom(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	wk, err := s.workout.Recalculate(r.Context(), user.ID, r.PathValue("id"), parts, workout.CalorieProfile{
		Method:      prefs.CalorieMethod,
		WeightKg:    prefs.BodyWeightKg,
		Age:         ageFromPrefs(prefs),
		Sex:         prefs.Sex,
		StepLengthM: stepLengthMeters(prefs),
	})
	if err != nil {
		s.writeWorkoutError(w, err)
		return
	}
	slog.Info("workout recalculated", "workout_id", wk.ID, "user_id", user.ID)
	writeJSON(w, http.StatusOK, wk)
}

func (s *Server) handleStats(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	st, err := s.workout.Stats(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not compute stats")
		return
	}
	writeJSON(w, http.StatusOK, st)
}

func (s *Server) handleGetPreferences(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	prefs, err := s.settings.UserPreferences(r.Context(), user.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load preferences")
		return
	}
	writeJSON(w, http.StatusOK, prefs)
}

// savePrefsRequest is the PUT /api/preferences body.
//
// A named type rather than an anonymous one so a test can hold it up against
// settings.UserPrefs. decodeJSON rejects unknown fields, and the client sends
// back the whole record it was given — so a field that GET emits and this
// struct has no name for is not ignored, it is a 400 on every save. That is how
// the weather switch shipped broken: nothing here knew the word.
type savePrefsRequest struct {
	CalorieMethod string  `json:"calorieMethod"`
	BodyWeightKg  float64 `json:"bodyWeightKg"`
	Sex           string  `json:"sex"`
	BirthYear     int     `json:"birthYear"`
	HeightCm      int     `json:"heightCm"`
	MaxHR         int     `json:"maxHr"`
	RestingHR     int     `json:"restingHr"`
	ThresholdPace string  `json:"thresholdPace"`
	FTP           int     `json:"ftp"`
	StepLengthCm  int     `json:"stepLengthCm"`

	// settings.Goal rather than a struct of its own, so there is one definition
	// of a goal's wire shape instead of two that have to be kept in step.
	//
	// It matters more than tidiness here: Goal.UnmarshalJSON accepts the
	// pre-metric shape, where a goal carried `count` and no `metric`. A second
	// struct did not, and because decodeJSON disallows unknown fields, every
	// save from a client still running the old bundle — a PWA holding a cached
	// service worker, an Android build a version behind — failed with "invalid
	// request body". Not just goal saves: the client PUTs the whole record, so
	// one stale goal in it broke every setting on every page.
	Goals []settings.Goal `json:"goals"`

	Notify *struct {
		Kinds map[string]bool `json:"kinds"`
		Push  bool            `json:"push"`
	} `json:"notify"`

	// A pointer, unlike every other field here, because this one defaults to
	// true rather than to its zero value. A plain bool would turn weather off
	// for anyone whose client sends the record back without it, and silently
	// disabling a feature is the worst way for that to fail. Absent means
	// "leave it on".
	WeatherEnabled *bool `json:"weatherEnabled"`
}

func (s *Server) handleSavePreferences(w http.ResponseWriter, r *http.Request) {
	user := httpmw.UserFrom(r)
	var req savePrefsRequest
	// Lenient: this endpoint takes back the whole record it handed out, from
	// clients that update on their own schedule. See decodeJSONLenient.
	if err := decodeJSONLenient(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	method := req.CalorieMethod
	if method != "heart-rate" && method != "distance" {
		method = "heart-rate"
	}
	weight := req.BodyWeightKg
	if weight <= 0 {
		weight = 70
	}
	clampNonNeg := func(n int) int {
		if n < 0 {
			return 0
		}
		return n
	}
	sex := req.Sex
	if sex != "male" && sex != "female" {
		sex = ""
	}
	birthYear := req.BirthYear
	if birthYear != 0 && (birthYear < 1900 || birthYear > time.Now().UTC().Year()) {
		birthYear = 0
	}
	// Goals are validated individually and silently dropped when they could
	// never be met, so one bad row can't reject an otherwise valid save.
	goals := make([]settings.Goal, 0, len(req.Goals))
	for _, goal := range req.Goals {
		if goal.Target <= 0 {
			continue
		}
		// An empty type means "any activity counts".
		if goal.Type != "" && !workout.ValidType(workout.Type(goal.Type)) {
			goal.Type = ""
		}
		// Decoding already normalized the goal, so the ceiling can be read off
		// the metric, period and span it settled on rather than what was sent.
		goal.Target = min(goal.Target, maxGoalTarget(goal))
		goals = append(goals, goal)
		if len(goals) >= maxGoals {
			break
		}
	}
	prefs := settings.UserPrefs{
		CalorieMethod: method,
		BodyWeightKg:  weight,
		Sex:           sex,
		BirthYear:     birthYear,
		HeightCm:      clampNonNeg(req.HeightCm),
		MaxHR:         clampNonNeg(req.MaxHR),
		RestingHR:     clampNonNeg(req.RestingHR),
		ThresholdPace: strings.TrimSpace(req.ThresholdPace),
		FTP:           clampNonNeg(req.FTP),
		StepLengthCm:  clampStepLength(req.StepLengthCm),

		Goals:          goals,
		WeatherEnabled: req.WeatherEnabled == nil || *req.WeatherEnabled,
	}
	// Unknown kinds are dropped so a stale or hand-crafted client cannot write
	// switches that nothing reads.
	if req.Notify != nil {
		kinds := make(map[notify.Kind]bool, len(req.Notify.Kinds))
		for k, enabled := range req.Notify.Kinds {
			if notify.ValidKind(notify.Kind(k)) {
				kinds[notify.Kind(k)] = enabled
			}
		}
		encoded, err := json.Marshal(notify.Prefs{Kinds: kinds, Push: req.Notify.Push})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "could not save preferences")
			return
		}
		prefs.Notify = encoded
	}
	if err := s.settings.SaveUserPreferences(r.Context(), user.ID, prefs); err != nil {
		writeError(w, http.StatusInternalServerError, "could not save preferences")
		return
	}
	writeJSON(w, http.StatusOK, prefs)
}

func (s *Server) writeWorkoutError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, workout.ErrNotFound):
		writeError(w, http.StatusNotFound, "workout not found")
	case errors.Is(err, workout.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal error")
	}
}

// maxGoals is how many training goals one user may keep. The dashboard renders
// every one of them, so the cap is about a readable page as much as storage.
const maxGoals = 12

// maxGoalTarget caps a goal at something a human could plausibly do in the
// window — beyond that it is a typo rather than a plan. Per day of the window,
// that is three activities, 300 km, or 12 hours.
func maxGoalTarget(g settings.Goal) float64 {
	days := 7 * g.Span
	if g.Period == "month" {
		days = 31 * g.Span
	}
	switch g.Metric {
	case settings.MetricDistance:
		return float64(days) * 300
	case settings.MetricDuration:
		return float64(days) * 12
	}
	return float64(days) * 3
}
