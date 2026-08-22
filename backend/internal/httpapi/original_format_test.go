package httpapi

import "testing"

// The gzipped case is the one worth a test: Strava and Garmin export archives
// of individually gzipped files, so the extension that reaches us is ".gz" and
// the format anyone cares about is the one before it.
func TestOriginalFormat(t *testing.T) {
	for _, tc := range []struct{ name, want string }{
		{"", ""},
		{"morning_run.gpx", "GPX"},
		{"ACTIVITY.FIT", "FIT"},
		{"export.tcx", "TCX"},
		{"activity_12345.fit.gz", "FIT (gzipped)"},
		{"unnamed.gz", "GZ"},
		{"noextension", ""},
	} {
		if got := originalFormat(tc.name); got != tc.want {
			t.Errorf("originalFormat(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
}
