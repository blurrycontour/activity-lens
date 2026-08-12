// Package equipment contains the equipment domain: gear (shoes, watches,
// bikes, …) that a user owns and can associate with workouts. It mirrors the
// structure of the workout package: model, a persistence interface, a
// SQLite-backed repository, and a thin service that owns ownership checks.
package equipment

// Equipment is a piece of gear owned by a user.
type Equipment struct {
	ID           string `json:"id"`
	UserID       int64  `json:"-"`
	Name         string `json:"name"`
	Type         string `json:"type"` // shoes, watch, bike, apparel, other
	Brand        string `json:"brand"`
	Model        string `json:"model"`
	Notes        string `json:"notes"`
	Retired      bool   `json:"retired"`
	WorkoutCount int    `json:"workoutCount"`
	// TotalDistance and TotalDuration aggregate every workout this gear is
	// linked to, so callers can show mileage without fetching each workout.
	TotalDistance float64 `json:"totalDistance"` // meters
	TotalDuration int     `json:"totalDuration"` // seconds
	// RetireAtKm is the distance at which the user wants to replace this item.
	// Zero means "use the default for this equipment type".
	RetireAtKm float64 `json:"retireAtKm"`
	CreatedAt  string  `json:"createdAt"`
	UpdatedAt  string  `json:"updatedAt"`
}

// LinkedWorkout is a lightweight summary of a workout an equipment is used in.
type LinkedWorkout struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Type     string  `json:"type"`
	Date     string  `json:"date"` // YYYY-MM-DD
	Distance float64 `json:"distance"`
	Duration int     `json:"duration"`

	// The rest of what a workout row shows. Carried here so the gear page can
	// draw the same row as the workout list rather than a reduced one of its
	// own — the alternative was looking each workout up in the client's cache,
	// which renders a different row depending on whether that cache has loaded.
	ElevationGain float64 `json:"elevationGain"`
	Calories      int     `json:"calories"`
	AvgPace       float64 `json:"avgPace"`
	AvgSpeed      float64 `json:"avgSpeed"`
	Source        string  `json:"source,omitempty"`
}

// Input carries the fields a caller may set when creating equipment.
type Input struct {
	Name       string
	Type       string
	Brand      string
	Model      string
	Notes      string
	Retired    bool
	RetireAtKm float64
}

// Patch carries optional edits to a piece of equipment; nil fields are left
// unchanged.
type Patch struct {
	Name       *string
	Type       *string
	Brand      *string
	Model      *string
	Notes      *string
	Retired    *bool
	RetireAtKm *float64
}

var validTypes = map[string]struct{}{
	"shoes": {}, "watch": {}, "bike": {}, "apparel": {}, "other": {},
}

// ValidType reports whether t is a known equipment type.
func ValidType(t string) bool {
	_, ok := validTypes[t]
	return ok
}

// DefaultRetireKm is the distance at which each equipment type is conventionally
// replaced. Used when the user has not set their own threshold; types with no
// meaningful wear limit return 0 and are never nudged about.
func DefaultRetireKm(t string) float64 {
	switch t {
	case "shoes":
		return 600
	default:
		return 0
	}
}
