package settings

import (
	"context"
	"testing"
	"time"
)

// The ceiling the HR zones are a percentage of, and the order it is looked for
// in. Worth pinning because getting it wrong is silent: the zones still render,
// they are just measured against the wrong person, which is exactly the bug
// this replaced — every workout drawn against its own peak, so every one of
// them ended in Zone 5.
func TestAthleteMaxHR(t *testing.T) {
	ctx := context.Background()
	thisYear := time.Now().Year()

	tests := []struct {
		name  string
		prefs UserPrefs
		want  int
	}{
		{"configured value wins", UserPrefs{MaxHR: 174, BirthYear: thisYear - 30}, 174},
		{"age estimate when unset", UserPrefs{BirthYear: thisYear - 30}, 190},
		{"nothing known", UserPrefs{}, 0},
		// A birth year in the future, or one implying an impossible age, is
		// data entry rather than an athlete: better to say we do not know than
		// to hand the charts a negative ceiling.
		{"implausible birth year", UserPrefs{BirthYear: thisYear + 5}, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st := newTestStore(t)
			if err := st.SaveUserPreferences(ctx, 1, tt.prefs); err != nil {
				t.Fatalf("SaveUserPreferences() error = %v", err)
			}
			got, err := st.AthleteMaxHR(ctx, 1)
			if err != nil {
				t.Fatalf("AthleteMaxHR() error = %v", err)
			}
			if got != tt.want {
				t.Errorf("AthleteMaxHR() = %d, want %d", got, tt.want)
			}
		})
	}
}

// A user who has never opened Settings has no row at all, which must read as
// "we do not know" rather than as an error.
func TestAthleteMaxHRNoRow(t *testing.T) {
	got, err := newTestStore(t).AthleteMaxHR(context.Background(), 99)
	if err != nil || got != 0 {
		t.Fatalf("AthleteMaxHR() = %d, %v; want 0, nil", got, err)
	}
}
