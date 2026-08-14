package workout

import (
	"context"
	"fmt"
	"time"
)

// Sharing business rules. The service is where redaction happens, so every
// path that can hand a workout to someone who does not own it strips the
// owner-private fields — an API handler cannot leak them by omission.

// GetViewable returns a workout viewerID may read, redacted unless they own it.
// isOwner tells the caller whether to offer edit controls.
func (s *Service) GetViewable(ctx context.Context, viewerID int64, id string) (w *Workout, isOwner bool, err error) {
	w, err = s.repo.GetViewable(ctx, viewerID, id)
	if err != nil {
		return nil, false, err
	}
	isOwner = w.UserID == viewerID
	if !isOwner {
		w.Redact()
	}
	return w, isOwner, nil
}

// ListPublic returns other users' public workouts, redacted.
func (s *Service) ListPublic(ctx context.Context, viewerID int64) ([]Workout, error) {
	return redactAll(s.repo.ListPublicSummary(ctx, viewerID))
}

// ListSharedWithMe returns workouts shared directly with the viewer, redacted.
func (s *Service) ListSharedWithMe(ctx context.Context, viewerID int64) ([]Workout, error) {
	return redactAll(s.repo.ListSharedWithMeSummary(ctx, viewerID))
}

// redactAll strips owner-private fields from every row. Both feed queries
// already exclude the viewer's own workouts, so this is unconditional.
func redactAll(ws []Workout, err error) ([]Workout, error) {
	if err != nil {
		return nil, err
	}
	for i := range ws {
		ws[i].Redact()
	}
	return ws, nil
}

// SetVisibility changes who can see a workout the caller owns.
func (s *Service) SetVisibility(ctx context.Context, ownerID int64, id string, v Visibility) error {
	if !ValidVisibility(v) {
		return fmt.Errorf("%w: unknown visibility %q", ErrInvalid, v)
	}
	return s.repo.SetVisibility(ctx, ownerID, id, v)
}

// ListSharedByMeWith returns the caller's own workouts shared with one person.
//
// Not redacted, unlike the feeds: these are the caller's own workouts and they
// are looking at their own sharing from the other end.
func (s *Service) ListSharedByMeWith(ctx context.Context, ownerID, recipientID int64) ([]Workout, error) {
	return s.repo.ListSharedByMeWithSummary(ctx, ownerID, recipientID)
}

// ShareRecipients lists the users a workout the caller owns is shared with.
func (s *Service) ShareRecipients(ctx context.Context, ownerID int64, workoutID string) ([]int64, error) {
	return s.repo.ShareRecipients(ctx, ownerID, workoutID)
}

// ShareCounts maps workout id to recipient count for the caller's whole library.
func (s *Service) ShareCounts(ctx context.Context, ownerID int64) (map[string]int, error) {
	return s.repo.ShareCounts(ctx, ownerID)
}

// ShareRecipientsByWorkout lists, per workout, who the owner has shared it with.
func (s *Service) ShareRecipientsByWorkout(ctx context.Context, ownerID int64) (map[string][]int64, error) {
	return s.repo.ShareRecipientsByWorkout(ctx, ownerID)
}

// AddShare grants targetID read access to a workout the caller owns. It is
// idempotent; sharing with yourself is rejected as meaningless rather than
// silently stored, since it would otherwise show up as a phantom recipient.
func (s *Service) AddShare(ctx context.Context, ownerID int64, workoutID string, targetID int64) error {
	if targetID == ownerID {
		return fmt.Errorf("%w: cannot share a workout with yourself", ErrInvalid)
	}
	if targetID <= 0 {
		return fmt.Errorf("%w: invalid user id", ErrInvalid)
	}
	return s.repo.AddShare(ctx, ownerID, workoutID, targetID)
}

// RemoveShare revokes a direct share on a workout the caller owns.
func (s *Service) RemoveShare(ctx context.Context, ownerID int64, workoutID string, targetID int64) error {
	return s.repo.RemoveShare(ctx, ownerID, workoutID, targetID)
}

// PurgeUserShares removes every share naming a user. go-authkit deletes
// accounts with a bare DELETE and workout_shares has no foreign key to its
// table (an FK would make that delete fail), so this is called explicitly when
// an account goes away.
func (s *Service) PurgeUserShares(ctx context.Context, userID int64) error {
	return s.repo.DeleteSharesForUser(ctx, userID)
}

// GetBySourceID resolves the workout a (source, external id) pair already
// refers to, or ErrNotFound. It answers "would importing this create anything?"
// without importing — the same lookup CreateIdempotent makes, exposed so a
// preview can report a duplicate before the user commits.
func (s *Service) GetBySourceID(ctx context.Context, userID int64, source Source, externalID string) (*Workout, error) {
	if externalID == "" {
		return nil, ErrNotFound
	}
	return s.repo.GetByExternalID(ctx, userID, source, externalID)
}

// MaxHashBatch caps how many hashes one KnownContentHashes call may ask about.
// Every hash becomes a bound parameter, and SQLite's default limit is 999;
// staying well under it keeps the query valid without the caller having to know
// the dialect. Clients chunk larger batches.
const MaxHashBatch = 500

// ImportWindow spans the user's last n imports from a source.
func (s *Service) ImportWindow(ctx context.Context, userID int64, source Source, n int) (start, end time.Time, err error) {
	return s.repo.ImportWindow(ctx, userID, source, n)
}

// KnownContentHashes reports which of these files the user has already
// imported, so a bulk import can skip uploading them.
func (s *Service) KnownContentHashes(ctx context.Context, userID int64, hashes []string) ([]string, error) {
	if len(hashes) > MaxHashBatch {
		return nil, fmt.Errorf("%w: at most %d hashes per request", ErrInvalid, MaxHashBatch)
	}
	return s.repo.KnownContentHashes(ctx, userID, hashes)
}

// RecordRawFilename notes which file a workout was imported from, after its
// original has been archived.
func (s *Service) RecordRawFilename(ctx context.Context, workoutID, filename string) error {
	return s.repo.SetRawFilename(ctx, workoutID, filename)
}

// PurgeUserWorkouts deletes everything a user owns and returns the workout ids,
// so the caller can remove the archived upload files that go with them. Called
// when an account is deleted, for the same reason as PurgeUserShares: authkit
// removes the account without knowing this schema exists.
func (s *Service) PurgeUserWorkouts(ctx context.Context, userID int64) ([]string, error) {
	return s.repo.DeleteAllForUser(ctx, userID)
}

// --- Weather ----------------------------------------------------------------

// PendingWeather returns the next batch of workouts owed a lookup, for the
// background pass. See Repository.ListPendingWeather on why this must be fully
// returned before any network work begins.
func (s *Service) PendingWeather(ctx context.Context, userIDs []int64, maxAttempts, limit int) ([]WeatherTarget, error) {
	return s.repo.ListPendingWeather(ctx, userIDs, maxAttempts, limit)
}

// ResolveWeatherStart locates a workout that predates the weather feature, by
// reading its route. See the repository method.
func (s *Service) ResolveWeatherStart(ctx context.Context, workoutID string) (lat, lon float64, ok bool, err error) {
	return s.repo.ResolveWeatherStart(ctx, workoutID)
}

// RecordWeather stores a fetched reading.
func (s *Service) RecordWeather(ctx context.Context, workoutID string, w Weather) error {
	return s.repo.SetWeather(ctx, workoutID, WeatherOK, w)
}

// MarkWeatherSkipped settles a workout that can never have weather.
func (s *Service) MarkWeatherSkipped(ctx context.Context, workoutID string) error {
	return s.repo.MarkWeatherSkipped(ctx, workoutID)
}

// MarkWeatherFailed counts a failed attempt against the retry budget.
func (s *Service) MarkWeatherFailed(ctx context.Context, workoutID string) error {
	return s.repo.MarkWeatherFailed(ctx, workoutID)
}

// SetManualWeather records conditions a person typed in.
//
// Ownership is checked here rather than in the repository — unlike the
// background pass, which has already established it by selecting per user, this
// is reachable from a request, and a workout id is guessable enough that the
// check has to be somewhere. Get is owner-scoped, so a workout belonging to
// anybody else is ErrNotFound before anything is written.
//
// The status becomes WeatherManual, which the fetcher never overwrites: someone
// who corrected a temperature from their own notes should not find a 25 km grid
// average back in its place after the next pass.
func (s *Service) SetManualWeather(ctx context.Context, userID int64, workoutID string, w Weather) error {
	if _, err := s.repo.Get(ctx, userID, workoutID); err != nil {
		return err
	}
	if err := validateWeather(w); err != nil {
		return err
	}
	return s.repo.SetWeather(ctx, workoutID, WeatherManual, w)
}

// ClearManualWeather puts a workout back to whatever the fetcher can find,
// so a mistaken manual entry is undoable rather than permanent.
func (s *Service) ClearManualWeather(ctx context.Context, userID int64, workoutID string) error {
	if _, err := s.repo.Get(ctx, userID, workoutID); err != nil {
		return err
	}
	return s.repo.SetWeather(ctx, workoutID, WeatherPending, Weather{})
}

// RequestWeatherBackfill queues this user's never-checked workouts and reports
// how many were queued.
func (s *Service) RequestWeatherBackfill(ctx context.Context, userID int64) (int, error) {
	return s.repo.RequestWeatherBackfill(ctx, userID)
}

// RetryFailedWeather re-queues this user's exhausted lookups.
func (s *Service) RetryFailedWeather(ctx context.Context, userID int64) (int, error) {
	return s.repo.RetryFailedWeather(ctx, userID)
}

// WeatherCounts tallies this user's workouts by weather status.
func (s *Service) WeatherCounts(ctx context.Context, userID int64) (WeatherCounts, error) {
	return s.repo.WeatherCounts(ctx, userID)
}

// validateWeather rejects values that are not physically possible.
//
// Not fussiness: these land in a chart that averages them, so a typo of 250
// instead of 25 does not look wrong on the workout it was entered on — it
// quietly bends a whole temperature bucket in the analysis.
func validateWeather(w Weather) error {
	switch {
	case w.TempC < -90 || w.TempC > 60:
		return fmt.Errorf("%w: temperature must be between -90 and 60 °C", ErrInvalid)
	case w.ApparentC < -120 || w.ApparentC > 80:
		return fmt.Errorf("%w: apparent temperature is out of range", ErrInvalid)
	case w.Humidity < 0 || w.Humidity > 100:
		return fmt.Errorf("%w: humidity must be between 0 and 100%%", ErrInvalid)
	case w.WindKph < 0 || w.WindKph > 500:
		return fmt.Errorf("%w: wind speed is out of range", ErrInvalid)
	case w.PrecipMm < 0 || w.PrecipMm > 2000:
		return fmt.Errorf("%w: precipitation is out of range", ErrInvalid)
	case w.Code < 0 || w.Code > 99:
		return fmt.Errorf("%w: weather code must be a WMO code (0-99)", ErrInvalid)
	}
	return nil
}

// Tracks returns simplified routes for the overview map.
func (s *Service) Tracks(ctx context.Context, userID int64, q TrackQuery) ([]Track, error) {
	return s.repo.ListTracks(ctx, userID, q)
}

// MissingTracks returns workouts still owed a simplified route.
func (s *Service) MissingTracks(ctx context.Context, limit int) ([]TrackBackfill, error) {
	return s.repo.ListMissingTracks(ctx, limit)
}

// StoreTrack simplifies and stores one workout's route.
func (s *Service) StoreTrack(ctx context.Context, workoutID string, route []LatLng) error {
	return s.repo.SetTrack(ctx, workoutID, route)
}

// TracksPending reports how many of a user's workouts have yet to be prepared.
func (s *Service) TracksPending(ctx context.Context, userID int64) (int, error) {
	return s.repo.CountMissingTracks(ctx, userID)
}
