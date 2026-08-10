package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/settings"
)

// decodeSavePrefs runs a body through the same decoder the handler uses.
func decodeSavePrefs(t *testing.T, body string) savePrefsRequest {
	t.Helper()
	r := httptest.NewRequest(http.MethodPut, "/api/preferences", strings.NewReader(body))
	var req savePrefsRequest
	if err := decodeJSONLenient(r, &req); err != nil {
		t.Fatalf("PUT /api/preferences rejected the body: %v\nbody: %s", err, body)
	}
	return req
}

// Saving preferences ignores fields it does not know, rather than failing.
//
// The client sends back the whole record it was given, and clients update on
// their own schedule: an Android APK installed months ago, a PWA holding a
// cached service worker. Under a strict decoder, one field that client knows
// and this server does not fails every save, for every setting, including ones
// that have not changed in years.
func TestSavePreferencesIgnoresFieldsItDoesNotKnow(t *testing.T) {
	req := decodeSavePrefs(t, `{
		"calorieMethod":"distance","bodyWeightKg":72,
		"somethingFromAFutureRelease":{"nested":true},
		"goals":[{"id":"a","metric":"count","target":2,"period":"week","span":1,"type":"","minKm":0,"minMinutes":0,"whatIsThis":9}]
	}`)
	if req.CalorieMethod != "distance" || req.BodyWeightKg != 72 {
		t.Errorf("known fields were lost: %+v", req)
	}
	if len(req.Goals) != 1 || req.Goals[0].Target != 2 {
		t.Errorf("goal did not survive an unknown sibling field: %+v", req.Goals)
	}
}

// A client that has not picked up the current bundle still sends goals the way
// they were shaped before metrics existed: a `count`, no `metric`, no `span`.
// decodeJSON disallows unknown fields, so a request struct that did not know
// the word `count` failed the whole save with "invalid request body" — and
// since the client PUTs the entire preferences record, that broke every setting
// on every page, not just goals.
//
// A stale service worker or an Android build a version behind is the normal
// state of a PWA for a while after a deploy, so this has to keep working.
func TestSavePreferencesAcceptsGoalsFromAnOlderClient(t *testing.T) {
	req := decodeSavePrefs(t, `{
		"calorieMethod":"heart-rate","bodyWeightKg":70,"sex":"","birthYear":0,
		"heightCm":0,"maxHr":0,"restingHr":0,"thresholdPace":"","ftp":0,"stepLengthCm":0,
		"goals":[{"id":"a","count":2,"period":"week","type":"Run","minKm":5}],
		"weatherEnabled":true
	}`)
	if len(req.Goals) != 1 {
		t.Fatalf("got %d goals, want 1", len(req.Goals))
	}
	g := req.Goals[0]
	if g.Metric != settings.MetricCount || g.Target != 2 {
		t.Errorf("legacy goal decoded as metric=%q target=%v, want count/2", g.Metric, g.Target)
	}
	if g.Span != 1 {
		t.Errorf("span = %d, want 1 — a goal without one is a plain single period", g.Span)
	}
}

// The other half of the same contract: whatever GET emits, PUT has to take back
// unchanged. The client edits one field of the record it was given and sends
// the rest as-is, so any field GET writes and PUT cannot name is a 400 on every
// save. TestSavePreferencesAcceptsEveryFieldItReturns checks the top level by
// reflection; this covers the nested goal, which reflection does not reach.
func TestSavePreferencesTakesBackTheGoalsItReturns(t *testing.T) {
	prefs := settings.DefaultUserPrefs()
	prefs.Goals = []settings.Goal{{
		ID: "a", Metric: settings.MetricDistance, Target: 40, Period: "month",
		Span: 2, Type: "Hike", MinKm: 5, MinMinutes: 30,
	}}
	prefs.Notify = json.RawMessage(`{"kinds":{"goal_met":true},"push":true}`)
	body, err := json.Marshal(prefs)
	if err != nil {
		t.Fatal(err)
	}
	req := decodeSavePrefs(t, string(body))
	if len(req.Goals) != 1 || req.Goals[0] != prefs.Goals[0] {
		t.Errorf("goal did not survive the round trip:\n got %+v\nwant %+v", req.Goals, prefs.Goals)
	}
}

// Targets are capped per metric, so a fat-fingered 4000 km cannot be stored as
// a goal nothing could ever meet.
func TestGoalTargetCeilingFollowsTheMetric(t *testing.T) {
	week := settings.Goal{Metric: settings.MetricCount, Period: "week", Span: 1}
	if got := maxGoalTarget(week); got != 21 {
		t.Errorf("weekly count ceiling = %v, want 21", got)
	}
	month := settings.Goal{Metric: settings.MetricDistance, Period: "month", Span: 1}
	if got := maxGoalTarget(month); got != 31*300 {
		t.Errorf("monthly distance ceiling = %v, want %v", got, 31*300)
	}
	// A longer window is allowed proportionally more.
	if got := maxGoalTarget(settings.Goal{Metric: settings.MetricDuration, Period: "week", Span: 3}); got != 21*12 {
		t.Errorf("three-week duration ceiling = %v, want %v", got, 21*12)
	}
}
