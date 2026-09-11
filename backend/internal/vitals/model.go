// Package vitals is the body-vitals domain: manually recorded weight and
// blood-pressure measurements a user keeps over time. It mirrors the shape of
// the equipment package — model, a persistence interface, a SQLite-backed
// repository, and a thin service that owns validation and ownership.
package vitals

import "time"

// Vital is one measurement event. A weight entry fills WeightKg; a
// blood-pressure entry fills Systolic/Diastolic/Pulse. The pointer fields are
// null when that reading was not part of this entry, which is how the charts
// tell a weight row from a blood-pressure one.
type Vital struct {
	ID         string   `json:"id"`
	UserID     int64    `json:"-"`
	MeasuredAt string   `json:"measuredAt"` // RFC3339
	WeightKg   *float64 `json:"weightKg,omitempty"`
	Systolic   *int     `json:"systolic,omitempty"`
	Diastolic  *int     `json:"diastolic,omitempty"`
	Pulse      *int     `json:"pulse,omitempty"`
	Note       string   `json:"note"`
	CreatedAt  string   `json:"createdAt"`
}

// Input carries the fields a caller may set when recording a measurement.
type Input struct {
	MeasuredAt time.Time
	WeightKg   *float64
	Systolic   *int
	Diastolic  *int
	Pulse      *int
	Note       string
}

// HasWeight reports whether this entry carries a weight reading.
func (v Vital) HasWeight() bool { return v.WeightKg != nil }

// HasBloodPressure reports whether this entry carries a blood-pressure reading.
func (v Vital) HasBloodPressure() bool { return v.Systolic != nil && v.Diastolic != nil }
