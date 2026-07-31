package httpapi

import (
	"net/url"
	"strings"
	"testing"
	"time"
)

// The link is the whole of "which ones were just imported": get it wrong and the
// notification lands on an unfiltered library, which is the failure it exists to
// prevent — and one that looks like working software.
func TestAutoImportLink(t *testing.T) {
	tests := []struct {
		name  string
		since time.Time
		until time.Time
		want  string
	}{
		{
			name:  "a window narrows the link to that batch",
			since: time.Date(2026, 7, 31, 11, 36, 45, 0, time.UTC),
			until: time.Date(2026, 7, 31, 11, 36, 49, 0, time.UTC),
			want:  "/workouts?source=autoimport&since=2026-07-31T11%3A36%3A45Z&until=2026-07-31T11%3A36%3A49Z",
		},
		{
			// What a library with fewer workouts than the batch claims produces.
			// Showing every auto-import is imprecise but useful; a filter that
			// matches nothing is not.
			name:  "no window falls back to every auto-import",
			since: time.Time{},
			until: time.Time{},
			want:  "/workouts?source=autoimport",
		},
		{
			// Half a window is not a window: an upper bound with no lower one
			// would read as "everything ever, up to now".
			name:  "a missing end drops the window entirely",
			since: time.Date(2026, 7, 31, 11, 36, 45, 0, time.UTC),
			until: time.Time{},
			want:  "/workouts?source=autoimport",
		},
		{
			// created_at is stored UTC, but nothing downstream should depend on
			// the caller having normalised it first.
			name:  "a zoned time is normalised to UTC",
			since: time.Date(2026, 7, 31, 13, 36, 45, 0, time.FixedZone("CEST", 2*60*60)),
			until: time.Date(2026, 7, 31, 13, 36, 49, 0, time.FixedZone("CEST", 2*60*60)),
			want:  "/workouts?source=autoimport&since=2026-07-31T11%3A36%3A45Z&until=2026-07-31T11%3A36%3A49Z",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := autoImportLink(tt.since, tt.until); got != tt.want {
				t.Errorf("autoImportLink(%v, %v) = %q, want %q", tt.since, tt.until, got, tt.want)
			}
		})
	}
}

// The client reads this back with URLSearchParams and Date.parse, so what goes
// in has to survive the round trip. A raw ":" in a query value is the kind of
// thing that works until something re-encodes the URL.
func TestAutoImportLinkSurvivesParsing(t *testing.T) {
	since := time.Date(2026, 7, 31, 11, 36, 45, 0, time.UTC)
	until := time.Date(2026, 7, 31, 11, 36, 49, 0, time.UTC)
	link := autoImportLink(since, until)

	u, err := url.Parse(link)
	if err != nil {
		t.Fatalf("the link is not a valid URL: %v", err)
	}
	if got := u.Query().Get("source"); got != "autoimport" {
		t.Errorf("source = %q, want autoimport", got)
	}
	for _, tc := range []struct {
		param string
		want  time.Time
	}{{"since", since}, {"until", until}} {
		got, err := time.Parse(time.RFC3339, u.Query().Get(tc.param))
		if err != nil {
			t.Fatalf("%s did not survive the round trip: %v", tc.param, err)
		}
		if !got.Equal(tc.want) {
			t.Errorf("%s = %v, want %v", tc.param, got, tc.want)
		}
	}
	if !strings.HasPrefix(link, "/workouts") {
		t.Errorf("link %q must stay in-app; the client routes it, not a browser", link)
	}
}
