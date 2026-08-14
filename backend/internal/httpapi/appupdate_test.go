package httpapi

import "testing"

// Every wrong answer here is a notification sent to every account on the
// instance, and two of the wrong answers are invisible from the code: telling
// people about an update on a server's very first run, and re-telling them
// about the same release on every restart.
func TestUpdateAnnouncement(t *testing.T) {
	cases := []struct {
		name             string
		last, current    string
		announce, record bool
	}{
		{"a new release is announced and remembered", "1.11.1", "1.12.0", true, true},
		{"a restart on the same release says nothing", "1.12.0", "1.12.0", false, false},
		// The first run of a server, or the first run after this feature
		// existed: nobody just received an update, but the version has to be
		// recorded or the next release cannot tell that it is one.
		{"a first run records without announcing", "", "1.12.0", false, true},
		// A rollback is still a change of release, and the app that goes with
		// this server is the older one — the same reason updateAvailable in the
		// client compares for difference rather than ordering.
		{"a rollback is announced too", "1.12.0", "1.11.1", true, true},
		// An untagged build has no release to speak of. Recording it would make
		// the next real release look like an upgrade from a version nobody ran.
		{"an unversioned build is ignored", "1.12.0", "", false, false},
		{"a dev build is ignored", "1.12.0", "dev", false, false},
		{"a dev build on a fresh server is not recorded", "", "dev", false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			announce, record := updateAnnouncement(c.last, c.current)
			if announce != c.announce || record != c.record {
				t.Errorf("updateAnnouncement(%q, %q) = announce %v, record %v; want %v, %v",
					c.last, c.current, announce, record, c.announce, c.record)
			}
		})
	}
}
