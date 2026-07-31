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
