package notify

import "testing"

// Adding a kind touches four places — the constant, AllKinds, the client's union
// type and its Settings list — and forgetting AllKinds produces a kind that is
// silently dropped by Notify rather than one that fails loudly.
func TestWorkoutImportedIsAKnownKind(t *testing.T) {
	if !ValidKind(KindWorkoutImported) {
		t.Fatal("workout_imported is not in AllKinds, so Notify will discard it")
	}
	if !DefaultPrefs().Wants(KindWorkoutImported) {
		t.Error("a new user would not receive auto-import notifications")
	}
}

// The case that breaks on every new kind: someone who saved their notification
// preferences before it existed has no entry for it. Defaulting a missing key to
// off would silently deny the new kind to every established user, and the bug
// would look like "auto import does not notify me" rather than a preferences
// problem.
func TestKindMissingFromSavedPrefsDefaultsOn(t *testing.T) {
	saved := Prefs{Kinds: map[Kind]bool{
		KindWorkoutShared: true,
		KindGearWorn:      false,
		KindGoalMet:       true,
		KindGoalAtRisk:    true,
	}}
	if !saved.Wants(KindWorkoutImported) {
		t.Error("a kind absent from saved preferences must default to on")
	}
	// The flip side, so this is not just asserting that Wants always says yes.
	if saved.Wants(KindGearWorn) {
		t.Error("an explicitly disabled kind must stay disabled")
	}
}

// The goal nudge is the one kind that fires on nothing having happened, so a
// registration slip here is not "a notification is missing" but "the app never
// nudges anyone" — invisible from the outside, since its absence looks exactly
// like the rate limiting working.
func TestGoalNoneSetIsAKnownKind(t *testing.T) {
	if !ValidKind(KindGoalNoneSet) {
		t.Fatal("goal_none_set is not in AllKinds, so Notify will discard it")
	}
	if !DefaultPrefs().Wants(KindGoalNoneSet) {
		t.Error("a new user would never be reminded to set a goal")
	}
}

// The social kind fires from a request path rather than from a background
// pass, so a registration slip here is a comment that stores fine and tells
// nobody — which looks like the notification being slow rather than absent.
func TestWorkoutSocialIsAKnownKind(t *testing.T) {
	if !ValidKind(KindWorkoutSocial) {
		t.Fatal("workout_social is not in AllKinds, so Notify will discard it")
	}
	if !DefaultPrefs().Wants(KindWorkoutSocial) {
		t.Error("a new user would hear nothing about comments on their workouts")
	}
}

// A ping is the one kind a person sends deliberately and immediately expects to
// land, so a registration slip here looks like the button being broken rather
// than like a notification being missed.
func TestPingIsAKnownKind(t *testing.T) {
	if !ValidKind(KindPing) {
		t.Fatal("ping is not in AllKinds, so Notify will discard it")
	}
	if !DefaultPrefs().Wants(KindPing) {
		t.Error("a new user would never receive a ping")
	}
}
