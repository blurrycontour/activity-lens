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
	// TypeOther is where an import lands when the file declares no sport and
	// its free text names none.
	//
	// Deliberately not something a person picks: it exists so that "we could not
	// tell" has an honest answer. Before it, such a file became a Run, which put
	// hikes into pace records they can never legitimately hold and into the
	// temperature correlation as though they were the same activity — wrong in a
	// way nothing on screen could reveal.
	TypeOther Type = "Other"
)

var validTypes = map[Type]struct{}{
	TypeRun: {}, TypeRide: {}, TypeHike: {}, TypeSwim: {}, TypeStrength: {}, TypeOther: {},
}

// ValidType reports whether t is a known activity type.
func ValidType(t Type) bool {
	_, ok := validTypes[t]
	return ok
}

// Source identifies where a workout came from. It pairs with Workout.ExternalID
// to give an imported workout a stable identity, so re-importing the same file
// or re-running a sync updates nothing instead of creating a duplicate.
type Source string

// Supported workout sources.
const (
	SourceUpload        Source = "upload"        // a .gpx/.tcx file the user uploaded
	SourceManual        Source = "manual"        // hand-entered in the import modal
	SourceHealthConnect Source = "healthconnect" // synced from Android Health Connect
	SourceAutoImport    Source = "autoimport"    // found by the Android app's folder watch
)

// ValidSource reports whether s is a source a client may claim.
//
// Only the folder watch names itself: everything else is decided server-side by
// which endpoint was called, and letting a request pick freely would let it
// claim an origin it does not have.
func ValidSource(s Source) bool {
	return s == SourceAutoImport
}

// Visibility controls who, beyond the owner, may read a workout. Direct shares
// are tracked separately in workout_shares and are orthogonal to this: making a
// workout private again does not revoke them.
type Visibility string

// Supported visibility values. There are deliberately only two — a "shared"
// value would duplicate what workout_shares already records.
const (
	VisibilityPrivate Visibility = "private"
	// VisibilityPublic means every signed-in user of this instance can read the
	// workout. It is never readable without authentication.
	VisibilityPublic Visibility = "public"
)

// ValidVisibility reports whether v is a known visibility value.
func ValidVisibility(v Visibility) bool {
	return v == VisibilityPrivate || v == VisibilityPublic
}

// OwnerRef identifies the author of a workout someone else is viewing. It is
// populated by the API layer from the user directory; the workout table has no
// join to the auth schema.
type OwnerRef struct {
	ID          int64  `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	AvatarPath  string `json:"avatarPath"`
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

// CadencePoint is a cadence sample at t seconds into the activity. The unit is
// steps per minute for foot-based activities and revolutions per minute for
// rides, matching whatever the source file reported.
type CadencePoint struct {
	T   int `json:"t"`
	Cad int `json:"cad"`
}

/*
ExtraPoint is one sample of a metric this app has no first-class home for.

FIT files carry more than the four series the app charts — power, temperature,
and whatever the next format brings. Rather than a column, a scanner slot and a
migration per metric, those arrive as named series: the workout says what it
has, and the detail page draws it. Nothing else reads them, which is the point.
They cannot be compared across workouts because not every workout has them, so
they belong on the one page that is about a single activity.

Float, not int, because the set is open: today's members are whole watts and
whole degrees, and the first breathing rate would have been rounded away.
*/
type ExtraPoint struct {
	T int     `json:"t"`
	V float64 `json:"v"`
}

// Pause is a stretch of a workout during which nothing was recorded, in
// seconds from the start. See pauses.go for how these are found and why only
// gaps in the recording count.
type Pause struct {
	From int `json:"from"`
	To   int `json:"to"`
}

// Workout is the domain model. The JSON tags produce exactly the shape the
// frontend expects.
type Workout struct {
	ID     string `json:"id"`
	UserID int64  `json:"-"`
	Name   string `json:"name"`
	Type   Type   `json:"type"`
	Date   string `json:"date"` // YYYY-MM-DD (derived from StartTime)
	// StartTime is the instant the workout began. Date is the same moment
	// truncated, and is what most of the UI wants; this is here because a few
	// places — the share card's header — need the time of day as well.
	StartTime      time.Time `json:"startTime"`
	Duration       int       `json:"duration"` // seconds
	Distance       float64   `json:"distance"` // meters
	AvgHR          int       `json:"avgHR"`
	MaxHR          int       `json:"maxHR"`
	ElevationGain  float64   `json:"elevationGain"`
	Calories       int       `json:"calories"`
	CaloriesManual bool      `json:"caloriesManual"`
	// CaloriesReported marks calories that the imported file stated outright
	// (TCX carries them per lap) rather than ones we estimated, so the UI
	// doesn't badge a source-provided number as computed.
	CaloriesReported bool           `json:"caloriesReported"`
	Steps            int            `json:"steps"`
	StepsManual      bool           `json:"stepsManual"`
	AvgPace          float64        `json:"avgPace"`  // seconds/km
	AvgSpeed         float64        `json:"avgSpeed"` // km/h
	Route            []LatLng       `json:"route"`
	HRTimeline       []HRPoint      `json:"hrTimeline"`
	PaceTimeline     []PacePoint    `json:"paceTimeline"`
	ElevTimeline     []ElevPoint    `json:"elevTimeline"`
	CadenceTimeline  []CadencePoint `json:"cadenceTimeline"`
	// ExtraSeries holds metrics beyond the four above, keyed by a stable name
	// ("power", "temperature"). Omitted when empty, which is every workout that
	// came from a GPX or a TCX.
	ExtraSeries map[string][]ExtraPoint `json:"extraSeries,omitempty"`
	// Pauses are the stretches with no samples in them. Omitted when empty,
	// which covers both "recorded straight through" and "too few samples to
	// tell" — MovingTime is what separates those.
	Pauses []Pause `json:"pauses,omitempty"`
	// MovingTime is Duration less the pauses, and is what AvgPace and AvgSpeed
	// are computed from. Zero means it was never worked out: every workout
	// imported before pauses existed, until it is recalculated. Clients read a
	// zero as "use Duration".
	MovingTime int    `json:"movingTime,omitempty"`
	Notes      string `json:"notes"`
	// CreatedAt is when this workout entered the library, which is not the same
	// as when it happened: an import can bring in a run from years ago. It is
	// what "the ones that just arrived" means.
	CreatedAt time.Time `json:"createdAt,omitempty"`
	// Source records where this workout came from so the UI can badge it.
	Source Source `json:"source,omitempty"`
	// ExternalID is this workout's identity within Source (the file's SHA-256
	// for uploads, the provider's record id for a sync). Empty means the
	// workout cannot be de-duplicated. Not exposed to clients.
	ExternalID string `json:"-"`
	// ContentHash is the SHA-256 of the original uploaded bytes, when there
	// were any. Not exposed to clients.
	ContentHash string `json:"-"`
	// ElevationLookup says the elevation series came from a terrain model
	// rather than from the device — see package elevation. It is what lets the
	// chart mark itself computed, which matters because a 90-metre grid is the
	// shape of the hill and not the shape of the ride.
	ElevationLookup bool `json:"elevationLookup,omitempty"`
	// Equipment is populated by the API layer for single-workout responses.
	Equipment []EquipmentTag `json:"equipment,omitempty"`
	// RawFilename is the name of the file this workout was imported from, when
	// the original was archived. Empty otherwise, which is how "is there an
	// original to download" is answered without touching the disk. Not exposed
	// directly — the API layer turns it into a boolean for the owner only, so a
	// filename can never say something about the owner to anyone else.
	RawFilename string `json:"-"`
	// Visibility is persisted; it is cleared on responses to non-owners, who
	// have no need to know why they can see the workout.
	Visibility Visibility `json:"visibility,omitempty"`
	// SharedWithCount is populated by the API layer on owner-facing lists so
	// the library can badge workouts that have direct recipients.
	SharedWithCount int `json:"sharedWithCount,omitempty"`
	// SharedWith names those people, on the owner's own profile. Only the API
	// layer fills it, and only where the viewer is the owner: who else can see
	// a workout is the owner's business and nobody else's.
	SharedWith []OwnerRef `json:"sharedWith,omitempty"`
	// Owner is populated by the API layer on responses to someone other than
	// the owner, and is nil on your own workouts.
	Owner *OwnerRef `json:"owner,omitempty"`

	// HasRoute reports whether this workout recorded a track, for list rows
	// which carry no route of their own. Read from the stored point count, so
	// it costs nothing beyond a column.
	HasRoute bool `json:"hasRoute,omitempty"`
	// HasCadence is the same question about the cadence series, which a list
	// row does not carry either.
	HasCadence bool `json:"hasCadence,omitempty"`
	// PhotoCount and CommentCount are filled by the API layer from one grouped
	// query per list, so a list can be filtered by "has photos" without
	// carrying the photos themselves.
	PhotoCount   int `json:"photoCount,omitempty"`
	CommentCount int `json:"commentCount,omitempty"`
	// Weather holds the conditions this workout happened in, or nil when there
	// are none to show. The pointer is what distinguishes "we do not know" from
	// a genuine 0 °C, since every stored column is NOT NULL DEFAULT 0.
	Weather *Weather `json:"weather,omitempty"`
	// WeatherStatus is why Weather is nil, so the UI can say something more
	// useful than nothing. Cleared for non-owners by Redact.
	WeatherStatus WeatherStatus `json:"weatherStatus,omitempty"`
}

// WeatherStatus is the lifecycle of a workout's weather lookup. Each value is
// documented in migrations/0022_workout_weather.sql.
type WeatherStatus string

const (
	// WeatherNone is the default: never queued for a lookup. Every workout that
	// predates this feature is here and stays here until the user explicitly
	// asks for a backfill — turning the setting on must not retroactively send
	// years of location history anywhere.
	WeatherNone WeatherStatus = "none"
	// WeatherPending is queued for the background pass.
	WeatherPending WeatherStatus = "pending"
	// WeatherOK means the values were fetched and are real.
	WeatherOK WeatherStatus = "ok"
	// WeatherManual means a person typed them in. A fetch must never overwrite
	// this: hand-corrected numbers beat a 25 km grid average.
	WeatherManual WeatherStatus = "manual"
	// WeatherSkipped means this workout can never have weather — no route, a
	// future start time, or an impossible coordinate.
	WeatherSkipped WeatherStatus = "skipped"
	// WeatherFailed means the lookup failed in a way that may succeed later.
	WeatherFailed WeatherStatus = "failed"
)

// HasReading reports whether this status means there are values worth showing.
func (s WeatherStatus) HasReading() bool {
	return s == WeatherOK || s == WeatherManual
}

// Weather is the conditions over the span of one workout.
//
// Aggregated across every hour the workout touched rather than sampled at its
// start: a four-hour hike that begins cold and ends in the sun is exactly the
// case where temperature matters most, and its start hour describes none of it.
// Means for the scalars, a total for rain, and the worst code seen.
type Weather struct {
	TempC     float64 `json:"tempC"`
	ApparentC float64 `json:"apparentC"`
	// Humidity is relative humidity, 0-100.
	Humidity float64 `json:"humidity"`
	WindKph  float64 `json:"windKph"`
	// PrecipMm is the total that fell during the workout, not a rate.
	PrecipMm float64 `json:"precipMm"`
	// Code is a WMO weather code, driving the icon and the label.
	Code int `json:"code"`
}

// WeatherTarget is the minimum needed to look one workout up: no route blob and
// no timelines, which is the whole reason the start coordinate is denormalised
// out of the route at insert.
type WeatherTarget struct {
	ID        string
	StartTime time.Time
	Duration  int
	Lat, Lon  float64
}

// WeatherCounts is a user's library tallied by weather status.
//
// Named by what each number means to a reader rather than by the status it came
// from: "recorded" folds ok and manual together, because from the outside a
// workout either has conditions on it or does not, and where they came from is
// the workout page's business.
type WeatherCounts struct {
	// Recorded is every workout with conditions, however they got there.
	Recorded int `json:"recorded"`
	// Manual is the subset of Recorded that was typed in, and so is never
	// touched by a lookup.
	Manual int `json:"manual"`
	// Scheduled is queued for the background pass — including anything held up
	// by Open-Meteo rate limiting us, which does not count as a failure.
	Scheduled int `json:"scheduled"`
	// Failed exhausted its retries. Recoverable only by an explicit retry.
	Failed int `json:"failed"`
	// Skipped can never have weather: indoor, or no GPS.
	Skipped int `json:"skipped"`
	// Unchecked predates the feature and is only ever queued by a backfill.
	Unchecked int `json:"unchecked"`
}

// Redact clears the fields that belong to the owner alone. The service applies
// it to every workout returned to a user who does not own it, so redaction is
// structural rather than something each API handler has to remember.
func (w *Workout) Redact() {
	w.Notes = ""
	w.Equipment = nil
	w.Visibility = ""
	// The original file is the owner's, and its name can carry more than the
	// workout does — a device's export naming, a folder, a personal label. It
	// is never serialized, but clearing it here means no later code path can
	// derive a "download original" affordance for someone who may not have it.
	w.RawFilename = ""
	// The reading itself stays — it is a property of the workout, and the route
	// it came from is already visible. The status goes: "not fetched" or
	// "failed" describes the owner's settings and their server, which is not
	// something a viewer has any business inferring.
	w.WeatherStatus = ""
}

// EquipmentTag is a minimal reference to a piece of equipment linked to a
// workout, attached to workout responses by the API layer.
type EquipmentTag struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
}

// Input carries the fields a caller may set when creating or importing a
// workout. Derived metrics (pace/speed) are filled in by the service.
type Input struct {
	Name             string
	Type             Type
	StartTime        time.Time
	Duration         int
	Distance         float64
	AvgHR            int
	MaxHR            int
	ElevationGain    float64
	Calories         int
	CaloriesReported bool // Calories came from the source file, not an estimate
	Steps            int
	StepLengthM      float64 // user's stride length in metres; 0 = per-activity default
	Route            []LatLng
	HRTimeline       []HRPoint
	PaceTimeline     []PacePoint
	ElevTimeline     []ElevPoint
	CadenceTimeline  []CadencePoint
	// ExtraSeries carries whatever named metrics the source file had beyond the
	// four charted everywhere; see Workout.ExtraSeries.
	ExtraSeries map[string][]ExtraPoint
	Notes       string
	// Source, ExternalID and ContentHash drive de-duplication; see the
	// corresponding fields on Workout. Source defaults to SourceManual when
	// left empty.
	Source      Source
	ExternalID  string
	ContentHash string
}

// Patch carries optional edits to an existing workout. Nil fields are left
// unchanged.
type Patch struct {
	Name      *string
	Type      *Type
	Notes     *string
	StartTime *time.Time
	Calories  *int
	Steps     *int
	// Distance in metres. Editable because a treadmill export often carries a
	// total the app cannot derive: the track points hold heart rate and time and
	// no position at all, so the distance the machine displayed is the only one
	// there is, and sometimes the file omits even that.
	Distance *float64
	// StepLengthM is the user's stride, needed only alongside Distance: the step
	// estimate is distance over stride, so correcting one without the other
	// leaves a count that contradicts the figure it was derived from.
	StepLengthM float64
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
