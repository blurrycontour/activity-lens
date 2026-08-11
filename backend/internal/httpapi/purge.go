package httpapi

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/blurrycontour/go-authkit/auth"
)

// Deleting an account is the one operation that has to know about every kind of
// thing this application stores, because go-authkit owns the users table and
// knows nothing about the schema built around it. There is no foreign key from
// any of our tables to users — authkit removes accounts with a bare DELETE, and
// an FK would abort it — so nothing is cleaned up on our behalf. This file is
// the single list of what a user owns; anything added to it later that is keyed
// by a user id belongs here too, or it becomes a leak nobody notices.

// purgeTimeout bounds the whole purge. A user with years of history can have
// thousands of workouts and as many archived files, and the request context is
// deliberately not used (see purgeUserData), so this is what stops a wedged
// disk from leaving a goroutine running for the life of the process.
const purgeTimeout = 2 * time.Minute

// purgeUserData removes everything belonging to a deleted account: workouts and
// their archived uploads, gear, shares in both directions, notifications and
// push subscriptions, preferences, and the avatar image.
//
// Every step is best-effort and logged rather than fatal. The account itself is
// already gone by the time this runs, so the deletion has succeeded from the
// user's point of view; failing the response over a leftover row would report
// the wrong outcome and invite a retry that cannot work — the account is no
// longer there to delete. What the log gives instead is the one thing an
// operator needs: which user, and which artifact, so it can be cleared by hand.
//
// The steps are ordered so a failure part-way through still leaves the database
// consistent, and so nothing that another step depends on is removed early:
// workout ids are read out before the rows are deleted, because the archived
// files on disk are named after them and would otherwise be unfindable.
func (s *Server) purgeUserData(ctx context.Context, user auth.User) {
	// Detached from the request: a client that closes the connection mid-delete
	// would otherwise cancel the purge half-finished, and the account is
	// already gone, so there is nothing left to abandon the work for. This
	// matters most for self-deletion, where the browser navigates away as soon
	// as it has the response.
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), purgeTimeout)
	defer cancel()

	fail := func(what string, err error) {
		slog.Error("could not purge data for deleted user",
			"artifact", what, "user_id", user.ID, "username", user.Username, "error", err)
	}

	workoutIDs, err := s.workout.PurgeUserWorkouts(ctx, user.ID)
	if err != nil {
		fail("workouts", err)
	}
	// Only reached with the ids in hand; on the error above this is skipped
	// rather than guessed at, leaving the files for manual cleanup.
	if len(workoutIDs) > 0 {
		if err := s.rawUploads.DeleteMany(ctx, workoutIDs); err != nil {
			fail("archived uploads", err)
		}
		// Gallery photos, one directory per workout. Not batched into a single
		// scan the way the archived uploads are: these are already separate
		// directories, so removing them is the same number of syscalls either
		// way, and deleting an account is not a hot path.
		for _, id := range workoutIDs {
			s.media.RemoveWorkout(id)
		}
	}
	// Gallery rows on their own workouts went with the workouts; this is for
	// any they added to someone else's, which have no key back to the account.
	if err := s.workout.PurgeUserPhotos(ctx, user.ID); err != nil {
		fail("workout photos", err)
	}
	// Shares the user owned went with their workouts via the foreign key; this
	// is for the ones naming them as a recipient, which have no key to cascade.
	if err := s.workout.PurgeUserShares(ctx, user.ID); err != nil {
		fail("workout shares", err)
	}
	if err := s.equipment.PurgeUser(ctx, user.ID); err != nil {
		fail("equipment", err)
	}
	if err := s.notify.PurgeUser(ctx, user.ID); err != nil {
		fail("notifications", err)
	}
	if err := s.feedback.PurgeUser(ctx, user.ID); err != nil {
		fail("feedback", err)
	}
	if err := s.settings.PurgeUser(ctx, user.ID); err != nil {
		fail("preferences", err)
	}
	// Generated avatars are rendered on demand and have no file to remove, so
	// avatarDiskPath returning "" is the normal case for anyone who never
	// uploaded one.
	if path := avatarDiskPath(s.avatarsDir(), user.AvatarPath); path != "" {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			fail("avatar", err)
		}
	}
	slog.Info("purged data for deleted user",
		"user_id", user.ID, "username", user.Username, "workouts", len(workoutIDs))
}
