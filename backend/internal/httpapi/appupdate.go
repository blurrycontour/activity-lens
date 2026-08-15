package httpapi

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/blurrycontour/activity-lens/backend/internal/notify"
)

// AppUpdateLink is the in-app path an update notification points at.
//
// Not a page: the client treats it as "start the update" rather than as
// somewhere to navigate. It is a path anyway because that is the one field the
// whole delivery chain already carries — the notification row, the Web Push
// payload, and the Android tap intent — and adding a second one for a single
// kind would mean touching all three.
const AppUpdateLink = "/update"

// announceAppUpdate tells everyone once, when this server starts carrying an
// Android app it has not announced before.
//
// Keyed on the bundled APK's version, not the server's. They usually move
// together — both come from one build — but they are separate artifacts, and
// only one of them is something a user has to act on: the web app is served by
// this very process and a browser picks up the new build on its next load,
// while the phone is a separate install that only looks for an update when it
// is opened. A server-only deployment therefore says nothing, because there is
// nothing for anyone to install; a server with no APK at all says nothing
// either, for the same reason.
//
// At startup rather than on a ticker because the trigger is a deployment, and a
// deployment is a restart. Two things keep it from repeating itself: the
// recorded version, which makes a restart on the same release silent, and the
// dedupe key, which makes a second attempt at the same release a no-op per user
// even if the record were lost.
func (s *Server) announceAppUpdate(ctx context.Context) {
	app := s.androidApp()
	if !app.Available {
		// No app to install, so no update to announce — and nothing to record
		// either: an image built without an APK must not leave a version behind
		// that makes the next image with one look like an upgrade.
		return
	}
	last, err := s.settings.AnnouncedVersion(ctx)
	if err != nil {
		slog.Warn("could not read the announced version", "error", err)
		return
	}
	version := strings.TrimSpace(app.Version)
	announce, record := updateAnnouncement(last, version)
	if record {
		// Recorded before the fan-out, not after. A crash midway then costs one
		// missed announcement rather than re-announcing to everyone on every
		// restart, and the dedupe key means the users who were already told
		// cannot be told twice regardless.
		if err := s.settings.SetAnnouncedVersion(ctx, version); err != nil {
			slog.Warn("could not record the announced version", "error", err)
			return
		}
	}
	if !announce {
		return
	}

	users, err := s.auth.ListUsers(ctx)
	if err != nil {
		slog.Warn("could not load users to announce an update", "error", err)
		return
	}
	sent := 0
	for _, u := range users {
		// Inactive accounts cannot sign in, so an update is not theirs to
		// install — the same reason a broadcast skips them by default.
		if !u.IsActive {
			continue
		}
		s.notify.Notify(ctx, notify.Event{
			UserID: u.ID,
			Kind:   notify.KindAppUpdate,
			// No product name in the title: Android already puts the app's own
			// name above the notification, so "Activity Lens 2.1.0 is
			// available" arrived as Activity Lens saying its own name twice.
			Title: fmt.Sprintf("Update %s available", version),
			Body:  "A new version of app is ready. Don't be a dinosaur and Update now!",
			Link:  AppUpdateLink,
			// Keyed on the version, so this is at most one notification per
			// user per release however many times the server restarts.
			DedupeKey: "app-update:" + version,
		})
		sent++
	}
	slog.Info("announced app update", "version", version, "was", last, "recipients", sent)
}

// updateAnnouncement decides whether this release is worth telling everyone
// about, and whether to remember it.
//
// Pure, and separate from the fan-out, because every wrong answer here is a
// notification sent to every account on the instance — including the two that
// look identical from the code and opposite from the outside: announcing a
// first run tells people about an update that never happened, and failing to
// record one announces the same release again on every restart.
func updateAnnouncement(last, current string) (announce, record bool) {
	// A plain `go build` has no version, and a dev build's "version" changes
	// with every commit — announcing either would be noise about a release
	// nobody published, and recording it would make the next real release look
	// like an upgrade from a version that was never deployed.
	if current == "" || current == "dev" {
		return false, false
	}
	if last == current {
		return false, false
	}
	// Nothing recorded means this instance has never announced anything: a
	// first run, or an upgrade from a build that predates this. Either way the
	// users did not just receive an update, so telling them one arrived would
	// be a notification about nothing — but the version is still worth
	// recording, or the *next* release cannot tell it is one.
	if last == "" {
		return false, true
	}
	return true, true
}
