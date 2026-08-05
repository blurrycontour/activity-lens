package httpapi

import (
	"reflect"
	"strings"
	"testing"

	"github.com/blurrycontour/activity-lens/backend/internal/settings"
)

// GET /api/preferences returns the whole record and PUT takes the whole record
// back — the client edits one field of what it was given and sends the rest
// unchanged. decodeJSON calls DisallowUnknownFields, so a field that GET emits
// and the PUT body has no name for does not get ignored: every save 400s, for
// every setting on the page, not just the new one.
//
// That is exactly how the weather switch shipped broken. It cost nothing to
// find by hand and would have cost nothing to catch here, which is the whole
// argument for this test: the failure is silent at compile time, invisible in
// review, and total at runtime.
func TestSavePreferencesAcceptsEveryFieldItReturns(t *testing.T) {
	accepted := jsonNames(reflect.TypeOf(savePrefsRequest{}))
	for name := range jsonNames(reflect.TypeOf(settings.UserPrefs{})) {
		if !accepted[name] {
			t.Errorf("GET /api/preferences returns %q but PUT rejects it — "+
				"saving any preference will fail with 400", name)
		}
	}
}

// The reverse is a smaller problem — a field nobody sends is dead weight rather
// than a broken page — but it is still a field somebody meant to wire up.
func TestSavePreferencesHasNoFieldsThatGoNowhere(t *testing.T) {
	stored := jsonNames(reflect.TypeOf(settings.UserPrefs{}))
	for name := range jsonNames(reflect.TypeOf(savePrefsRequest{})) {
		if !stored[name] {
			t.Errorf("PUT /api/preferences accepts %q but nothing stores it", name)
		}
	}
}

// A bool that defaults to true cannot be a plain bool in a request body: absent
// and false decode identically, so any client that omits it silently turns the
// feature off. Named fields whose stored default is true have to be pointers.
func TestWeatherEnabledSurvivesAClientThatOmitsIt(t *testing.T) {
	f, ok := reflect.TypeOf(savePrefsRequest{}).FieldByName("WeatherEnabled")
	if !ok {
		t.Fatal("no WeatherEnabled field")
	}
	if f.Type.Kind() != reflect.Ptr {
		t.Error("WeatherEnabled is a plain bool, so a client that omits it turns weather off")
	}
	// And the stored default has to agree: the handler reads a nil pointer as
	// true, which is only right if that is what a fresh record says too.
	if !settings.DefaultUserPrefs().WeatherEnabled {
		t.Error("an absent weatherEnabled reads as on, but the stored default is off")
	}
}

// jsonNames collects a struct's JSON field names, ignoring options like
// omitempty and fields marked "-".
func jsonNames(t reflect.Type) map[string]bool {
	out := make(map[string]bool, t.NumField())
	for i := 0; i < t.NumField(); i++ {
		tag := t.Field(i).Tag.Get("json")
		if tag == "" || tag == "-" {
			continue
		}
		if name, _, _ := strings.Cut(tag, ","); name != "" {
			out[name] = true
		}
	}
	return out
}
