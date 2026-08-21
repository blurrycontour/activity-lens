package ingest

import (
	"errors"
	"math"
	"strings"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

/*
What a decoded FIT file means.

fit.go turns bytes into messages; this turns messages into a workout. The two
are separate so that swapping the decoder — for a FIT SDK, if hand-decoding ever
stops being worth it — is a change to one file and not to the meaning of a
single field.

Everything here works from the FIT profile's field numbers, which are stable
across versions of the format by design: a field number means the same thing in
a file written in 2011 and one written today, and new fields take new numbers.
That is what makes reading a documented subset safe rather than fragile.
*/

// Why a FIT file can be read fine and still not be importable.
var (
	// errNotAnActivity is a valid FIT file that records something else: a
	// planned workout, a course, a device settings dump, a weight reading.
	errNotAnActivity = errors.New("parse fit: this file is not a recorded activity")
	// errNoActivityData is an activity with neither samples nor a summary,
	// which is a file that recorded nothing.
	errNoActivityData = errors.New("parse fit: no activity data in this file")
)

// Field numbers within the record message (global 20).
const (
	recTimestamp = 253
	recLat       = 0
	recLon       = 1
	recAltitude  = 2
	recHeartRate = 3
	recCadence   = 4
	recDistance  = 5
	recSpeed     = 6
	recPower     = 7
	recTemp      = 13
	// The "enhanced" fields are the same quantities in a wider type, added when
	// the originals ran out of range (a 16-bit speed tops out at 65 m/s, an
	// altitude at 6553 m). Modern files write both; where they differ, these are
	// the ones that are not clipped.
	recEnhSpeed = 73
	recEnhAlt   = 78
)

// Field numbers within the session message (global 18).
const (
	sesTimestamp   = 253
	sesStartTime   = 2
	sesElapsedTime = 7
	sesDistance    = 9
	sesSport       = 5
	sesSubSport    = 6
	sesCalories    = 11
	sesAvgHR       = 16
	sesMaxHR       = 17
	sesAscent      = 22
)

// Field numbers within the sport (global 12) and file_id (global 0) messages.
const (
	sportSport      = 0
	sportSubSport   = 1
	sportName       = 3
	fileType        = 0
	fileTimeCreated = 4
)

// fileTypeActivity is the file_id type of a recorded activity. A FIT file can
// just as easily be a workout plan, a course, a settings dump or a weight-scale
// reading, and none of those are something to import as a session in the gym.
const fileTypeActivity = 4

/*
semicircleToDegrees converts FIT's angular unit.

FIT stores latitude and longitude as signed 32-bit "semicircles" covering the
full circle, which is what gives it sub-centimetre resolution in an integer.
*/
func semicircleToDegrees(v float64) float64 { return v * (180.0 / 2147483648.0) }

// Scale factors from the FIT profile. Each is the number the raw integer is
// divided by to reach the unit the rest of this package works in.
const (
	scaleAltitude  = 5.0    // altitude is in fifths of a metre...
	offsetAltitude = 500.0  // ...offset so that 0 is 500 m below sea level
	scaleSpeed     = 1000.0 // millimetres per second
	scaleDistance  = 100.0  // centimetres
	scaleTime      = 1000.0 // milliseconds
)

// parseFIT reads a FIT activity file into a workout Input.
func parseFIT(data []byte, defaultType workout.Type) (workout.Input, error) {
	msgs, err := decodeFIT(data)
	if err != nil {
		return workout.Input{}, err
	}
	return fitInput(msgs, defaultType)
}

// fitInput builds the workout from decoded messages.
//
// Separate from parseFIT so the mapping can be tested against hand-built
// messages, without a fixture file for every case that matters.
func fitInput(msgs []fitMessage, defaultType workout.Type) (workout.Input, error) {
	var (
		points  []trackPoint
		extras  = newExtraCollector()
		session fitMessage
		sport   fitMessage
		fileID  fitMessage
		start   time.Time
	)
	for _, m := range msgs {
		switch m.global {
		case msgRecord:
			p, ok := fitRecord(m)
			if !ok {
				continue
			}
			points = append(points, p)
			extras.add(m)
		case msgSession:
			// The first session wins. A multisport file has one per leg, and
			// its first is the one the start time and the sport belong to; the
			// alternative — merging them — would report a triathlon as a swim
			// of 40 km.
			if session.fields == nil {
				session = m
			}
		case msgSport:
			if sport.fields == nil {
				sport = m
			}
		case msgFileID:
			if fileID.fields == nil {
				fileID = m
			}
		}
	}

	// A file that says outright it is not an activity is refused, rather than
	// imported as a workout with no samples in it. A file that says nothing is
	// given the benefit of the doubt: some tools omit file_id entirely.
	if t, ok := fileID.num(fileType); ok && int(t) != fileTypeActivity {
		return workout.Input{}, errNotAnActivity
	}
	if len(points) == 0 && session.fields == nil {
		return workout.Input{}, errNoActivityData
	}

	if t, ok := session.timestamp(sesStartTime); ok {
		start = t
	} else if t, ok := fileID.timestamp(fileTimeCreated); ok {
		start = t
	}

	calories := 0
	if v, ok := session.num(sesCalories); ok {
		calories = int(v)
	}

	in := buildInput(fitName(sport, session), fitType(session, sport, defaultType), points, calories, start)
	in.ExtraSeries = extras.result()
	applyFitSession(&in, session)
	return in, nil
}

// fitRecord turns one record message into a track point, reporting whether it
// held anything worth keeping.
//
// A record with a timestamp and nothing else is real and common — it is what a
// paused watch writes — but it carries no measurement, so it is dropped rather
// than added as a point with every field at zero.
func fitRecord(m fitMessage) (trackPoint, bool) {
	p := trackPoint{}
	if t, ok := m.timestamp(recTimestamp); ok {
		p.Time, p.HasTime = t, true
	}
	lat, hasLat := m.num(recLat)
	lon, hasLon := m.num(recLon)
	if hasLat && hasLon {
		p.Lat, p.Lng = semicircleToDegrees(lat), semicircleToDegrees(lon)
		// A watch searching for satellites writes 0,0 as readily as a real fix.
		// Null Island is in the Gulf of Guinea, so a run that starts there is a
		// run that started before the GPS locked.
		p.HasLL = p.Lat != 0 || p.Lng != 0
	}
	if v, ok := m.num(recEnhAlt); ok {
		p.Elev, p.HasElev = v/scaleAltitude-offsetAltitude, true
	} else if v, ok := m.num(recAltitude); ok {
		p.Elev, p.HasElev = v/scaleAltitude-offsetAltitude, true
	}
	if v, ok := m.num(recHeartRate); ok && v > 0 {
		p.HR, p.HasHR = int(v), true
	}
	if v, ok := m.num(recCadence); ok {
		p.Cad, p.HasCad = int(v), true
	}
	if v, ok := m.num(recEnhSpeed); ok {
		p.Speed, p.HasSpeed = v/scaleSpeed, true
	} else if v, ok := m.num(recSpeed); ok {
		p.Speed, p.HasSpeed = v/scaleSpeed, true
	}
	if !p.HasTime && !p.HasLL && !p.HasHR && !p.HasElev {
		return trackPoint{}, false
	}
	return p, true
}

/*
extraCollector gathers the series the app has no column for.

Keyed on seconds from the first record rather than on the absolute timestamp,
because that is the clock every chart in the app draws against — and the one
trimming rebases. Records with no timestamp are skipped rather than guessed at:
a sample whose position on the axis is unknown is worse than no sample.
*/
type extraCollector struct {
	series map[string][]workout.ExtraPoint
	start  time.Time
	have   bool
}

func newExtraCollector() *extraCollector {
	return &extraCollector{series: map[string][]workout.ExtraPoint{}}
}

// fitExtras maps a record field onto a series name. Adding a metric is one
// line here plus a label on the client; nothing in between has to change.
var fitExtras = []struct {
	field byte
	name  string
	// convert turns the raw field into the unit the label promises. nil means
	// the number is already in it.
	convert func(float64) float64
}{
	{field: recPower, name: "power"},
	{field: recTemp, name: "temperature"},
}

func (c *extraCollector) add(m fitMessage) {
	ts, ok := m.timestamp(recTimestamp)
	if !ok {
		return
	}
	if !c.have {
		c.start, c.have = ts, true
	}
	t := int(ts.Sub(c.start).Seconds())
	if t < 0 {
		return
	}
	for _, e := range fitExtras {
		v, ok := m.num(e.field)
		if !ok {
			continue
		}
		if e.convert != nil {
			v = e.convert(v)
		}
		c.series[e.name] = append(c.series[e.name], workout.ExtraPoint{T: t, V: v})
	}
}

// minExtraSamples is how many points a series needs before it is worth
// carrying. Two samples is not a chart, and a single stray reading from a
// sensor that connected for one second and dropped is worse than nothing.
const minExtraSamples = 3

// result returns the series worth keeping, or nil.
func (c *extraCollector) result() map[string][]workout.ExtraPoint {
	out := map[string][]workout.ExtraPoint{}
	for name, series := range c.series {
		if len(series) < minExtraSamples {
			continue
		}
		// A sensor that reported the same number for the whole activity
		// reported nothing: a power meter left asleep sends zeros, and a
		// temperature that never moved is a device that never read one.
		flat := true
		for _, p := range series[1:] {
			if p.V != series[0].V {
				flat = false
				break
			}
		}
		if flat && series[0].V == 0 {
			continue
		}
		out[name] = series
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

/*
applyFitSession fills in from the session summary what the samples could not.

Everything here is a fallback for a value the samples did not yield — except
distance, which the session wins outright.

That is deliberate and it is the one place this differs from the GPX and TCX
importers. Those have nothing but coordinates, so distance can only be the sum
of the gaps between fixes. A FIT file has the figure the device itself arrived
at, from the same fixes fused with an accelerometer or a foot pod and with its
own error model — which is also the number the watch displayed at the end of the
run, and therefore the number the person remembers. Summing haversines over the
device's own fixes to contradict it would be showing our arithmetic instead of
their workout. It also covers the case where there is no route at all: an indoor
ride, a treadmill run, a pool swim, all of which would otherwise import as
"0.00 km".
*/
func applyFitSession(in *workout.Input, session fitMessage) {
	if session.fields == nil {
		return
	}
	if v, ok := session.num(sesDistance); ok && v > 0 {
		in.Distance = v / scaleDistance
	}
	if in.Duration == 0 {
		if v, ok := session.num(sesElapsedTime); ok {
			in.Duration = int(math.Round(v / scaleTime))
		}
	}
	if in.AvgHR == 0 {
		if v, ok := session.num(sesAvgHR); ok && v > 0 {
			in.AvgHR = int(v)
		}
	}
	if in.MaxHR == 0 {
		if v, ok := session.num(sesMaxHR); ok && v > 0 {
			in.MaxHR = int(v)
		}
	}
	if in.ElevationGain == 0 {
		if v, ok := session.num(sesAscent); ok {
			in.ElevationGain = v
		}
	}
	if in.StartTime.IsZero() {
		if t, ok := session.timestamp(sesStartTime); ok {
			in.StartTime = t.UTC()
		}
	}
}

// fitType decides what kind of activity this was.
//
// The sport enum is turned into its profile name and handed to the same
// classifier GPX and TCX use, rather than mapped straight onto a workout.Type
// here. That keeps one table of "words that mean running" in the codebase: a
// FIT file saying sport=1 and a GPX track called "Running" should not be able to
// disagree, and they cannot if they arrive at the answer the same way.
//
// The sub-sport is a hint rather than an answer, and it is consulted second:
// sport=fitness_equipment with sub_sport=treadmill is a run, but sub_sport is
// also where "trail", "road" and "generic" live, which name no activity at all.
func fitType(session, sport fitMessage, def workout.Type) workout.Type {
	num := func(m fitMessage, field byte) string {
		v, ok := m.num(field)
		if !ok {
			return ""
		}
		return fitSportName(int(v))
	}
	hints := []string{
		fitSubSportName(session, sport),
		num(sport, sportSport),
	}
	// The sport's own name last, and the label after it: both are free text as
	// far as the classifier is concerned, and both are weaker evidence than a
	// code. "Rowing" is not a type here, but it is a word, and a file whose only
	// clue is a name is exactly what inferType exists for.
	if name, ok := sport.text(sportName); ok {
		hints = append(hints, name)
	}
	if v, ok := session.num(sesSport); ok {
		if label := fitSportLabel(int(v)); label != "" {
			hints = append(hints, fitLabelToName(label))
		}
	}
	return mapType(num(session, sesSport), hints, def)
}

// fitSubSportName resolves the sub-sport from wherever it was recorded.
func fitSubSportName(session, sport fitMessage) string {
	for _, m := range []fitMessage{session, sport} {
		for _, field := range []byte{sesSubSport, sportSubSport} {
			if v, ok := m.num(field); ok {
				if name := fitSubSportNameFor(int(v)); name != "" {
					return name
				}
			}
		}
	}
	return ""
}

// fitName picks what to call the activity.
//
// FIT has no field for the name a person gave a session — that lives in the app
// they synced to, not in the file — so this is a sport and a fallback, in the
// same shape TCX imports use so the two look alike in a list.
func fitName(sport, session fitMessage) string {
	if name, ok := sport.text(sportName); ok && strings.TrimSpace(name) != "" {
		return truncateName(strings.TrimSpace(name))
	}
	for _, m := range []fitMessage{session, sport} {
		field := byte(sesSport)
		if m.global == msgSport {
			field = sportSport
		}
		if v, ok := m.num(field); ok {
			if label := fitSportLabel(int(v)); label != "" {
				return label + " Activity"
			}
		}
	}
	// Failing that, the sub-sport. A treadmill run and an indoor ride both
	// arrive as sport=fitness_equipment, which has no name worth printing —
	// but the sub-sport does, and "Cycling Activity" beats "Imported Activity"
	// for a row someone has to recognise in a list.
	if name := fitSubSportName(session, sport); name != "" {
		return strings.ToUpper(name[:1]) + strings.ReplaceAll(name[1:], "_", " ") + " Activity"
	}
	return "Imported Activity"
}
