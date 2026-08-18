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

import (
	"encoding/json"
	"strings"
)

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

// Block is one slot in a day, holding one or more exercises.
//
// Required says how many of them to do, which is the whole of the block's
// behaviour:
//
//	1                 choose one — bench press *or* push-ups
//	len(Options)      do all of them — a superset
//	anything between  "two of these three", which is how accessory work is
//	                  usually written
//
// A count rather than a mode flag, because those are three numbers of one
// rule, and an enum would have needed a count column beside it the moment the
// middle case turned up.
type Block struct {
	ID      string     `json:"id"`
	Options []Exercise `json:"options"`
	// Required is clamped to 1..len(Options) on the way in; zero from an old
	// client reads as 1.
	Required int `json:"required"`
	// RestSec is the break taken after this block, before starting the next
	// one. Distinct from Exercise.RestSec, which is the wait between sets of
	// the same exercise: ninety seconds between sets and three minutes before
	// changing station are two different numbers, and one field could only
	// ever be right about one of them. Zero means no break is planned.
	RestSec int `json:"restSec"`
	// Section marks a block as something other than working sets — a warm-up,
	// a cool-down, stretching. Empty is an ordinary block.
	//
	// On the block rather than the day: a warm-up is five minutes at the top
	// of a day that also has working sets, and stretching turns up at both
	// ends. Unknown values are cleared on the way in rather than rejected, so
	// a newer client cannot write something an older one renders as a blank.
	Section Section `json:"section,omitempty"`
	// DurationSec lets a section stand on its own with no exercises in it —
	// "warm up for ten minutes". Zero means the block's exercises say how long
	// it takes, which is every ordinary block. Only meaningful with a Section:
	// a block of working sets with no exercises is nothing at all.
	DurationSec int `json:"durationSec,omitempty"`
}

// Section is what a block is, when it is not working sets.
type Section string

const (
	// SectionNone is an ordinary block of exercises.
	SectionNone Section = ""
	// SectionWarmup is the work done before the working sets.
	SectionWarmup Section = "warmup"
	// SectionCooldown is the work done after them.
	SectionCooldown Section = "cooldown"
	// SectionStretch is mobility work, which happens at either end.
	SectionStretch Section = "stretch"
)

// ValidSection reports whether s is one this package knows.
func ValidSection(s Section) bool {
	return s == SectionNone || s == SectionWarmup || s == SectionCooldown || s == SectionStretch
}

// Kind is what an exercise is measured in.
type Kind string

const (
	// KindWeight is sets × reps at a load in kilograms.
	KindWeight Kind = "weight"
	// KindBody is sets × reps against bodyweight. WeightKg stays meaningful as
	// *added* load — weighted pull-ups and dips are written this way.
	KindBody Kind = "body"
	// KindTime is sets × a duration: planks, dead hangs, carries.
	KindTime Kind = "time"
)

// ValidKind reports whether k is one this package knows.
func ValidKind(k Kind) bool {
	return k == KindWeight || k == KindBody || k == KindTime
}

// Exercise is one option inside a block, with its own targets: swapping to
// push-ups should bring push-up numbers, not the bench press's.
type Exercise struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind Kind   `json:"kind"`
	Sets int    `json:"sets"`
	// Reps is free text on purpose. "8" and "8-10" are both things people
	// write in a plan; nothing computes on the range, so nothing needs it
	// parsed. Ignored when Kind is KindTime.
	Reps string `json:"reps"`
	// DurationSec is the length of one set when Kind is KindTime.
	DurationSec int `json:"durationSec"`
	// WeightKg is the load for KindWeight, and the *added* load for KindBody.
	WeightKg float64 `json:"weightKg"`
	RestSec  int     `json:"restSec"`
	// BreakSec is the pause after this exercise before the next one *in the
	// same block* — the minute between the movements of a superset. The third
	// of three distinct waits, and neither of the others could be it:
	// RestSec is between sets of this exercise, and Block.RestSec is after the
	// whole block.
	BreakSec int    `json:"breakSec"`
	Note     string `json:"note"`
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

// BlockProgress is what was chosen and what was done inside one block.
type BlockProgress struct {
	// Picks indexes Block.Options — one entry for a choose-one block, several
	// for a superset or a "two of three". Out-of-range values are ignored
	// rather than rejected: a plan edited mid-session should still load.
	Picks []int `json:"picks"`
	// Sets keyed by exercise id, not one flat list for the block.
	//
	// Switching from bench press to push-ups used to clear the sets, because
	// there was nowhere to put two exercises' work. Keying by exercise means
	// changing your mind twice costs nothing, and a superset can log each of
	// its exercises separately.
	Sets map[string][]SetLog `json:"sets"`
	// legacySets holds the flat list the first version wrote, until Stats can
	// attribute it to the option that was picked. Never marshalled.
	legacySets []SetLog
}

// UnmarshalJSON accepts both the current shape and the first version's, where
// `pick` was a single index and `sets` a flat array belonging to it. Sessions
// started before this change are still readable; without it they would come
// back with no progress at all.
func (b *BlockProgress) UnmarshalJSON(data []byte) error {
	var raw struct {
		Picks []int           `json:"picks"`
		Pick  int             `json:"pick"`
		Sets  json.RawMessage `json:"sets"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	b.Picks = raw.Picks
	if len(b.Picks) == 0 && raw.Pick > 0 {
		b.Picks = []int{raw.Pick}
	}
	b.Sets = map[string][]SetLog{}
	trimmed := strings.TrimSpace(string(raw.Sets))
	switch {
	case trimmed == "" || trimmed == "null":
		return nil
	case trimmed[0] == '[':
		return json.Unmarshal(raw.Sets, &b.legacySets)
	default:
		return json.Unmarshal(raw.Sets, &b.Sets)
	}
}

// SetLog is one set: whether it was done, what was actually lifted, and when.
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
	// At is when the set was marked done, RFC 3339. It is what lets history
	// show how long a session's work actually took, and the gap between one
	// set and the next.
	At string `json:"at,omitempty"`
	// DurationSec is how long the set was held, for a timed exercise.
	DurationSec int `json:"durationSec,omitempty"`
	// StartedAt is when the set was begun, RFC 3339, set by the first tap.
	//
	// A set has three states in the runner — waiting, under way, done — and
	// this is what tells the first two apart across a reload. It also gives
	// history the length of the set itself rather than only the gap between
	// one set being finished and the next.
	StartedAt string `json:"startedAt,omitempty"`
}

// EffectivePicks is which options are being done in this block.
//
// An untouched block defaults to its first Required options, so a superset
// counts all of its exercises before anything has been ticked and the session
// total does not jump around as the user makes choices.
func (b Block) EffectivePicks(p BlockProgress) []int {
	required := b.Required
	if required < 1 {
		required = 1
	}
	if required > len(b.Options) {
		required = len(b.Options)
	}

	seen := map[int]bool{}
	out := make([]int, 0, required)
	for _, i := range p.Picks {
		if i < 0 || i >= len(b.Options) || seen[i] {
			continue
		}
		seen[i] = true
		out = append(out, i)
	}
	// Top up with the first options not already chosen, so a half-made choice
	// still describes a whole block.
	for i := 0; i < len(b.Options) && len(out) < required; i++ {
		if !seen[i] {
			seen[i] = true
			out = append(out, i)
		}
	}
	return out
}

// SetsFor returns the logged sets for one option of a block.
func (p BlockProgress) SetsFor(optionID string, isFirstPick bool) []SetLog {
	if sets, ok := p.Sets[optionID]; ok {
		return sets
	}
	// A session started before sets were keyed by exercise has one flat list,
	// which belonged to whichever option was picked.
	if isFirstPick {
		return p.legacySets
	}
	return nil
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
			// A section that is only a duration — "warm up for ten minutes" —
			// counts as the one thing it is, so the client's tally and this
			// one agree about what the day contains.
			if b.Section != SectionNone && b.DurationSec > 0 {
				total++
				if sets := s.Progress.Blocks[b.ID].Sets[b.ID]; len(sets) > 0 && sets[0].Done {
					done++
				}
			}
			continue
		}
		p := s.Progress.Blocks[b.ID]
		for n, idx := range b.EffectivePicks(p) {
			ex := b.Options[idx]
			total += ex.Sets
			for i, set := range p.SetsFor(ex.ID, n == 0) {
				// A snapshot edited down to fewer sets than were logged should
				// not count the orphans.
				if i >= ex.Sets || !set.Done {
					continue
				}
				done++
				volume += ex.setVolume(set)
			}
		}
	}
	return done, total, volume
}

// setVolume is the load moved by one set, in kilograms.
//
// Only weighted work counts. A held position has no repetitions to multiply,
// and bodyweight work would need a body weight this package has no business
// knowing — its *added* load still counts, which is what makes a weighted
// pull-up different from an unweighted one.
func (e Exercise) setVolume(set SetLog) float64 {
	if e.Kind == KindTime {
		return 0
	}
	kg := set.WeightKg
	if kg == 0 {
		kg = e.WeightKg
	}
	if kg == 0 {
		return 0
	}
	return kg * float64(repsFor(set.Reps, e.Reps))
}

// repsFor reads a rep count out of the free-text reps field for volume
// totalling, preferring what was actually done over what was planned.
//
// Best effort by design: "8-10" totals as 8 — the number the user committed
// to — and anything that names a unit of time contributes nothing, because
// seconds are not repetitions.
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
