// Package plans contains the training-plan domain: named routines a user
// writes (Push / Pull / Legs), the days inside them, and the sessions run
// against those days in the gym.
//
// It mirrors the structure of the equipment and workout packages: model, a
// persistence interface, a SQLite-backed repository, and a thin service that
// owns ownership checks and the rules.
//
// Weights are kilograms throughout, with no unit column anywhere. The app is
// metric everywhere else, and one feature carrying its own unit system is a
// conversion bug waiting for the first user who switches it.
package plans

import "strings"

// Plan is a training routine owned by a user.
type Plan struct {
	ID       string `json:"id"`
	UserID   int64  `json:"-"`
	Name     string `json:"name"`
	Notes    string `json:"notes"`
	Archived bool   `json:"archived"`
	// Days is populated by Get, and left nil by List — the list page shows
	// names and counts, and loading every exercise of every plan to render
	// them would be several hundred rows for a screen that draws a dozen.
	Days      []Day  `json:"days,omitempty"`
	DayCount  int    `json:"dayCount"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
	// LastSessionAt is when a day of this plan was last run, if ever.
	LastSessionAt string `json:"lastSessionAt,omitempty"`
}

// Day is one training day within a plan: "Chest & Triceps".
//
// Deliberately not tied to a weekday. People miss days, and a plan that
// insists chest is Tuesday is wrong by Wednesday.
type Day struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Blocks []Block `json:"blocks"`
}

// Block is one slot in a day.
//
// With a single option it is a plain exercise. With several it is a
// choose-one — bench press or push-ups — and the runner picks at the time.
// There is no kind flag because the count already says which it is, and a flag
// that can disagree with the options it describes is a flag that eventually
// does.
type Block struct {
	ID      string     `json:"id"`
	Options []Exercise `json:"options"`
	// RestSec is the break taken after this block, before starting the next
	// one. Distinct from Exercise.RestSec, which is the wait between sets of
	// the same exercise: ninety seconds between sets and three minutes before
	// changing station are two different numbers, and one field could only
	// ever be right about one of them. Zero means no break is planned.
	RestSec int `json:"restSec"`
}

// Exercise is one option inside a block, with its own targets: swapping to
// push-ups should bring push-up numbers, not the bench press's.
type Exercise struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Sets int    `json:"sets"`
	// Reps is free text on purpose. "8", "8-10" and "45 s" are all things
	// people write in a plan; nothing computes on it, so nothing needs it
	// parsed, and an integer column would force the last one to lie.
	Reps     string  `json:"reps"`
	WeightKg float64 `json:"weightKg"`
	RestSec  int     `json:"restSec"`
	Note     string  `json:"note"`
}

// PlanInput carries the fields a caller may set when creating a plan.
type PlanInput struct {
	Name  string
	Notes string
}

// PlanPatch carries optional edits to a plan's own fields; nil is unchanged.
// The day structure is replaced separately, through ReplaceDays.
type PlanPatch struct {
	Name     *string
	Notes    *string
	Archived *bool
}

// Session is one run of one day, from Start to Finish.
type Session struct {
	ID     string `json:"id"`
	UserID int64  `json:"-"`
	// PlanID is empty once the plan it came from has been deleted. The
	// session stays readable regardless — that is the point of the snapshot.
	PlanID   string `json:"planId,omitempty"`
	PlanName string `json:"planName"`
	DayName  string `json:"dayName"`
	// Snapshot is the day exactly as it stood when the session started.
	// History has to show the plan that was actually followed, and plans get
	// edited; anything that reads through to the live plan shows the wrong
	// numbers the moment someone bumps a weight.
	Snapshot   Day      `json:"snapshot"`
	Progress   Progress `json:"progress"`
	StartedAt  string   `json:"startedAt"`
	FinishedAt string   `json:"finishedAt,omitempty"`
	DoneSets   int      `json:"doneSets"`
	TotalSets  int      `json:"totalSets"`
	VolumeKg   float64  `json:"volumeKg"`
	Notes      string   `json:"notes"`
	// WorkoutID is set when finishing created a manual workout, which is a
	// per-user preference.
	WorkoutID string `json:"workoutId,omitempty"`
}

// Progress is what the runner has recorded so far, keyed by block id.
//
// Keyed rather than positional so that it survives being read back beside a
// snapshot: a map lookup that misses is an untouched block, where a positional
// array would silently shift every block after any change.
type Progress struct {
	Blocks map[string]BlockProgress `json:"blocks"`
}

// BlockProgress is the pick and the set log for one block.
type BlockProgress struct {
	// Pick indexes Block.Options. Out-of-range values are treated as 0 rather
	// than rejected: a plan edited mid-session should not fail to load.
	Pick int      `json:"pick"`
	Sets []SetLog `json:"sets"`
}

// SetLog is one set: whether it was done, and what was actually lifted.
//
// The actual weight is recorded per set rather than per exercise because the
// last set is often lighter than the first, and a plan that can only store the
// target quietly turns a drop set into a lie.
type SetLog struct {
	Done     bool    `json:"done"`
	WeightKg float64 `json:"weightKg"`
	// Reps actually performed, free text like the target. Empty means "as
	// planned", which is the common case and not worth storing.
	Reps string `json:"reps,omitempty"`
}

// Stats totals a session from its snapshot and progress.
//
// Computed on the server rather than accepted from the client: these numbers
// feed the history list and the consistency chart, and a client that has been
// backgrounded mid-session is exactly the client most likely to send a stale
// count.
func (s *Session) Stats() (done, total int, volume float64) {
	for _, b := range s.Snapshot.Blocks {
		if len(b.Options) == 0 {
			continue
		}
		p := s.Progress.Blocks[b.ID]
		ex := b.Options[0]
		if p.Pick > 0 && p.Pick < len(b.Options) {
			ex = b.Options[p.Pick]
		}
		total += ex.Sets
		for i, set := range p.Sets {
			// A snapshot edited down to fewer sets than were logged should
			// not count the orphans.
			if i >= ex.Sets || !set.Done {
				continue
			}
			done++
			kg := set.WeightKg
			if kg == 0 {
				kg = ex.WeightKg
			}
			volume += kg * float64(repsFor(set.Reps, ex.Reps))
		}
	}
	return done, total, volume
}

// repsFor reads a rep count out of the free-text reps field for volume
// totalling, preferring what was actually done over what was planned.
//
// Best effort by design: "8-10" totals as 8 (the number the user committed
// to), and "45 s" as 0 because seconds of plank are not kilograms lifted.
// Volume is a rough training-load figure, and inventing a number for a
// duration would make it a wrong one.
func repsFor(actual, planned string) int {
	for _, s := range []string{actual, planned} {
		if n := leadingInt(s); n > 0 && !hasTimeUnit(s) {
			return n
		}
	}
	return 0
}

func leadingInt(s string) int {
	s = strings.TrimSpace(s)
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int(r-'0')
		if n > 100000 {
			return 0
		}
	}
	return n
}

func hasTimeUnit(s string) bool {
	s = strings.ToLower(s)
	return strings.Contains(s, "s") || strings.Contains(s, "min")
}
