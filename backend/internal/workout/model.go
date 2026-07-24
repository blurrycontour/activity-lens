// Package workout contains the workout domain: model, persistence interface,
// a SQLite-backed repository, and the service that owns business rules
// (derived metrics, ownership checks, aggregate statistics).
package workout

import "time"

// Type is a supported activity type.
type Type string

// Supported activity types. These mirror the values used by the frontend.
const (
	TypeRun      Type = "Run"
	TypeRide     Type = "Ride"
	TypeHike     Type = "Hike"
	TypeSwim     Type = "Swim"
	TypeStrength Type = "Strength"
)

var validTypes = map[Type]struct{}{
	TypeRun: {}, TypeRide: {}, TypeHike: {}, TypeSwim: {}, TypeStrength: {},
}

// ValidType reports whether t is a known activity type.
func ValidType(t Type) bool {
	_, ok := validTypes[t]
	return ok
}

// LatLng is a geographic point [latitude, longitude], serialized as a 2-tuple
// to match the frontend route format.
type LatLng [2]float64

// HRPoint is a single heart-rate sample at t seconds into the activity.
type HRPoint struct {
	T  int `json:"t"`
	HR int `json:"hr"`
}

// PacePoint is a pace sample (seconds/km) at t seconds into the activity.
type PacePoint struct {
	T    int `json:"t"`
	Pace int `json:"pace"`
}

// ElevPoint is an elevation sample (meters) at t seconds into the activity.
type ElevPoint struct {
	T    int `json:"t"`
	Elev int `json:"elev"`
}

// Workout is the domain model. The JSON tags produce exactly the shape the
// frontend expects.
type Workout struct {
	ID            string      `json:"id"`
	UserID        int64       `json:"-"`
	Name          string      `json:"name"`
	Type          Type        `json:"type"`
	Date          string      `json:"date"` // YYYY-MM-DD (derived from StartTime)
	StartTime     time.Time   `json:"-"`
	Duration      int         `json:"duration"` // seconds
	Distance      float64     `json:"distance"` // meters
	AvgHR         int         `json:"avgHR"`
	MaxHR         int         `json:"maxHR"`
	ElevationGain float64     `json:"elevationGain"`
	Calories      int         `json:"calories"`
	AvgPace       float64     `json:"avgPace"`  // seconds/km
	AvgSpeed      float64     `json:"avgSpeed"` // km/h
	Route         []LatLng    `json:"route"`
	HRTimeline    []HRPoint   `json:"hrTimeline"`
	PaceTimeline  []PacePoint `json:"paceTimeline"`
	ElevTimeline  []ElevPoint `json:"elevTimeline"`
	Notes         string      `json:"notes"`
}

// Input carries the fields a caller may set when creating or importing a
// workout. Derived metrics (pace/speed) are filled in by the service.
type Input struct {
	Name          string
	Type          Type
	StartTime     time.Time
	Duration      int
	Distance      float64
	AvgHR         int
	MaxHR         int
	ElevationGain float64
	Calories      int
	Route         []LatLng
	HRTimeline    []HRPoint
	PaceTimeline  []PacePoint
	ElevTimeline  []ElevPoint
	Notes         string
}

// Patch carries optional edits to an existing workout. Nil fields are left
// unchanged.
type Patch struct {
	Name  *string
	Type  *Type
	Notes *string
}

// Stats is the aggregate dashboard summary for a user's library.
type Stats struct {
	Count          int            `json:"count"`
	TotalDistance  float64        `json:"totalDistance"`  // meters
	TotalDuration  int            `json:"totalDuration"`  // seconds
	TotalElevation float64        `json:"totalElevation"` // meters
	TotalCalories  int            `json:"totalCalories"`
	AvgHR          int            `json:"avgHR"`
	Last30Count    int            `json:"last30Count"`
	TypeCounts     map[Type]int   `json:"typeCounts"`
	Weekly         []WeeklyBucket `json:"weekly"`
}

// WeeklyBucket aggregates one week of activity for the volume chart.
type WeeklyBucket struct {
	Week     string  `json:"week"`
	Hours    float64 `json:"hours"`
	Count    int     `json:"count"`
	Distance float64 `json:"distance"` // meters
}
