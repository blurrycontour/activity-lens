package ingest

import "strings"

/*
FIT's sport and sub-sport enumerations, as far as they matter here.

Two things are wanted from a sport code: a word the shared classifier can read
(so a FIT file and a GPX track cannot disagree about what "running" means), and
something to call the workout in a list. They are not the same string — an
e-bike ride classifies as cycling but should not be labelled as it — so both sit
in one table rather than in two that could drift apart.

An unlisted code is not a failure. It leaves both blank, the classifier moves on
to the sub-sport and the sport name, and failing all of those the workout lands
on the caller's default. That is the right outcome for the long tail of the
enumeration: this app has six activity types, and FIT has ninety sports, most of
which are not exercise as this app understands it.
*/
type fitSport struct {
	// classify is a word matchType already understands, or "" when the code
	// names nothing this app has a type for.
	classify string
	// label is how the sport reads in a workout name, or "" for the same
	// reason.
	label string
}

var fitSports = map[int]fitSport{
	1:  {"running", "Running"},
	2:  {"cycling", "Cycling"},
	5:  {"swimming", "Swimming"},
	11: {"walking", "Walking"},
	17: {"hiking", "Hiking"},
	// Training is FIT's word for a gym session; its sub-sport says which kind.
	10: {"strength_training", "Training"},
	62: {"strength_training", "HIIT"},
	// An e-bike is still a ride, and a snowshoe is still a walk in the hills —
	// but neither should be *called* the thing it classifies as.
	21: {"cycling", "E-bike"},
	35: {"hiking", "Snowshoeing"},
	16: {"hiking", "Mountaineering"},
	// Sports with no type here, but a name worth keeping: without a label these
	// import as "Imported Activity", which tells a reader nothing.
	4:  {"", ""}, // fitness_equipment — indoor machine; the sub-sport decides
	12: {"", "Cross-country skiing"},
	13: {"", "Alpine skiing"},
	14: {"", "Snowboarding"},
	15: {"", "Rowing"},
	18: {"", "Multisport"},
	19: {"", "Paddling"},
	25: {"", "Golf"},
	30: {"", "Inline skating"},
	31: {"", "Rock climbing"},
	37: {"", "Paddleboarding"},
	38: {"", "Surfing"},
	41: {"", "Kayaking"},
	47: {"", "Boxing"},
	53: {"", "Diving"},
	64: {"", "Racket sport"},
}

/*
fitSubSports carries only the codes that name an activity on their own.

Most of the sub-sport enumeration describes *where* rather than *what* — road,
trail, track, street, generic — and reading those as activities is how a trail
ride becomes a run. The ones here are the machines and the indoor variants,
where the sub-sport is the only place the real activity is written down: a
treadmill run arrives as sport=fitness_equipment, which by itself is furniture.
*/
var fitSubSports = map[int]string{
	1:  "running",  // treadmill
	5:  "cycling",  // spin
	6:  "cycling",  // indoor_cycling
	7:  "cycling",  // road
	8:  "cycling",  // mountain
	9:  "cycling",  // downhill
	10: "cycling",  // recumbent
	11: "cycling",  // cyclocross
	12: "cycling",  // hand_cycling
	13: "cycling",  // track_cycling
	17: "swimming", // lap_swimming
	18: "swimming", // open_water
	20: "strength_training",
	27: "walking", // indoor_walking
	45: "running", // indoor_running
}

// fitSportName returns the classifier word for a sport code.
func fitSportName(code int) string { return fitSports[code].classify }

// fitSportLabel returns the human name for a sport code.
func fitSportLabel(code int) string { return fitSports[code].label }

// fitSubSportNameFor returns the classifier word for a sub-sport code.
//
// Zero is generic and means nothing, which is worth stating: it is the most
// common value in the field by a wide margin, and mapping it to anything at all
// would misfile most of the files that carry it.
func fitSubSportNameFor(code int) string {
	if code == 0 {
		return ""
	}
	return fitSubSports[code]
}

// fitLabelToName is what a label contributes when it is all there is: "Rock
// climbing" tells the classifier nothing, but "Rowing" is at least a word to
// try, and the free-text classifier is where words go.
func fitLabelToName(label string) string { return strings.ToLower(label) }
