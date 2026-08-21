package ingest

import (
	"math"
	"testing"
	"time"

	"github.com/blurrycontour/activity-lens/backend/internal/workout"
)

// The field layouts the tests below write. Kept together so a test reads as
// "this kind of file" rather than as a list of field numbers.
var (
	recordFields = []wField{
		{recTimestamp, 4, tUint32},
		{recLat, 4, tSint32},
		{recLon, 4, tSint32},
		{recAltitude, 2, tUint16},
		{recHeartRate, 1, tUint8},
		{recCadence, 1, tUint8},
		{recSpeed, 2, tUint16},
		{recPower, 2, tUint16},
		{recTemp, 1, tSint8},
	}
	sessionFields = []wField{
		{sesStartTime, 4, tUint32},
		{sesSport, 1, tEnum},
		{sesSubSport, 1, tEnum},
		{sesElapsedTime, 4, tUint32},
		{sesDistance, 4, tUint32},
		{sesCalories, 2, tUint16},
		{sesAvgHR, 1, tUint8},
		{sesMaxHR, 1, tUint8},
		{sesAscent, 2, tUint16},
	}
	fileIDFields = []wField{{fileType, 1, tEnum}, {fileTimeCreated, 4, tUint32}}
)

var fitStart = time.Date(2026, 4, 12, 6, 30, 0, 0, time.UTC)

// A complete outdoor run: file_id, records once a second, then the session
// summary. The shape every watch writes, and the baseline the rest of the file
// varies one thing at a time from.
func writeRunFIT(t *testing.T) []byte {
	t.Helper()
	w := newFitWriter()
	w.define(0, msgFileID, fileIDFields)
	w.data(0, fileIDFields, []any{fileTypeActivity, fitTime(fitStart)}, nil)
	w.define(1, msgRecord, recordFields)
	for i := 0; i < 60; i++ {
		ts := fitStart.Add(time.Duration(i) * time.Second)
		w.data(1, recordFields, []any{
			fitTime(ts),
			degreesToSemicircles(51.5 + float64(i)*0.0001),
			degreesToSemicircles(-0.12),
			int((100 + 500) * scaleAltitude), // 100 m
			140 + i%10,
			85,
			int(3.0 * scaleSpeed), // 3 m/s
			200 + i,
			14,
		}, nil)
	}
	w.define(2, msgSession, sessionFields)
	w.data(2, sessionFields, []any{
		fitTime(fitStart), 1, 0, int(59 * scaleTime), int(180.0 * scaleDistance), 420, 145, 168, 12,
	}, nil)
	return w.bytes()
}

func TestParseFITRun(t *testing.T) {
	in, err := parseFIT(writeRunFIT(t), workout.TypeOther)
	if err != nil {
		t.Fatal(err)
	}
	if in.Type != workout.TypeRun {
		t.Errorf("type = %q, want Run (sport=1)", in.Type)
	}
	if !in.StartTime.Equal(fitStart) {
		t.Errorf("start = %v, want %v", in.StartTime, fitStart)
	}
	if in.Duration != 59 {
		t.Errorf("duration = %d, want 59", in.Duration)
	}
	if len(in.Route) != 60 {
		t.Errorf("route has %d points, want 60", len(in.Route))
	}
	// 0.0001° of latitude is about 11 m, times 59 steps.
	if in.Distance < 600 || in.Distance > 700 {
		t.Errorf("distance = %.0f m, want roughly 656", in.Distance)
	}
	if in.AvgHR == 0 || in.MaxHR == 0 {
		t.Errorf("heart rate = %d/%d, want both set", in.AvgHR, in.MaxHR)
	}
	if in.Calories != 420 || !in.CaloriesReported {
		t.Errorf("calories = %d (reported %v), want 420 reported", in.Calories, in.CaloriesReported)
	}
	// Cadence is doubled for foot activities: 85 per foot is 170 steps.
	if len(in.CadenceTimeline) == 0 || in.CadenceTimeline[0].Cad != 170 {
		t.Errorf("cadence = %v, want 170 (per-foot 85 doubled)", in.CadenceTimeline)
	}
	// A recorded speed is used as-is rather than derived from the fixes.
	if len(in.PaceTimeline) != 60 {
		t.Errorf("pace has %d samples, want one per record from the speed field", len(in.PaceTimeline))
	}
	if got := in.PaceTimeline[0].Pace; got != 333 {
		t.Errorf("pace = %d s/km, want 333 (3 m/s)", got)
	}
}

// The extra series are the reason FIT is worth reading at all rather than the
// GPX beside it: nothing else in the app's formats carries power.
func TestParseFITExtraSeries(t *testing.T) {
	in, err := parseFIT(writeRunFIT(t), workout.TypeOther)
	if err != nil {
		t.Fatal(err)
	}
	power := in.ExtraSeries["power"]
	if len(power) != 60 {
		t.Fatalf("power has %d samples, want 60", len(power))
	}
	if power[0].T != 0 || power[0].V != 200 {
		t.Errorf("first power sample = %+v, want t=0 v=200", power[0])
	}
	// Seconds from the start, like every other series — not the FIT timestamp,
	// which is a number in the billions and would put every chart off its axis.
	if last := power[len(power)-1]; last.T != 59 || last.V != 259 {
		t.Errorf("last power sample = %+v, want t=59 v=259", last)
	}
	if len(in.ExtraSeries["temperature"]) != 60 {
		t.Errorf("temperature has %d samples, want 60", len(in.ExtraSeries["temperature"]))
	}
	if _, ok := in.ExtraSeries["heart_rate"]; ok {
		t.Error("heart rate is a first-class series and must not be duplicated as an extra")
	}
}

// A sensor that was never there reports a constant zero for the whole ride.
// Carrying that is worse than carrying nothing: it draws a flat line at the
// bottom of a chart that claims the rider produced no power for two hours.
func TestParseFITDropsDeadSensors(t *testing.T) {
	w := newFitWriter()
	w.define(1, msgRecord, recordFields)
	for i := 0; i < 10; i++ {
		w.data(1, recordFields, []any{
			fitTime(fitStart.Add(time.Duration(i) * time.Second)),
			degreesToSemicircles(51.5), degreesToSemicircles(-0.12),
			int((100 + 500) * scaleAltitude), 140, 85, int(3.0 * scaleSpeed),
			0,  // power: present, and nothing but zero
			14, // temperature: constant, but a real reading
		}, nil)
	}
	in, err := parseFIT(w.bytes(), workout.TypeRun)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := in.ExtraSeries["power"]; ok {
		t.Error("a power series of nothing but zeros was kept")
	}
	if len(in.ExtraSeries["temperature"]) != 10 {
		t.Error("a constant but non-zero reading is real data and must be kept")
	}
}

// An indoor session has no position at all, so distance cannot be derived. The
// machine's own total is the only one there is, and without it the workout
// imports as 0.00 km — which is the thing importing a FIT file is meant to fix.
func TestParseFITIndoorTakesSessionTotals(t *testing.T) {
	fields := []wField{{recTimestamp, 4, tUint32}, {recHeartRate, 1, tUint8}}
	w := newFitWriter()
	w.define(0, msgFileID, fileIDFields)
	w.data(0, fileIDFields, []any{fileTypeActivity, fitTime(fitStart)}, nil)
	w.define(1, msgRecord, fields)
	for i := 0; i < 30; i++ {
		w.data(1, fields, []any{fitTime(fitStart.Add(time.Duration(i) * time.Second)), 130}, nil)
	}
	w.define(2, msgSession, sessionFields)
	w.data(2, sessionFields, []any{
		fitTime(fitStart), 4 /* fitness_equipment */, 6, /* indoor_cycling */
		int(1800 * scaleTime), int(12000.0 * scaleDistance), 300, 132, 150, 0,
	}, nil)

	in, err := parseFIT(w.bytes(), workout.TypeOther)
	if err != nil {
		t.Fatal(err)
	}
	if in.Distance != 12000 {
		t.Errorf("distance = %.0f, want the session's 12000 m", in.Distance)
	}
	// The sport is furniture; the sub-sport is the activity.
	if in.Type != workout.TypeRide {
		t.Errorf("type = %q, want Ride from sub_sport=indoor_cycling", in.Type)
	}
	if len(in.Route) != 0 {
		t.Error("an indoor session must not produce a route")
	}
}

// Duration comes from the session when the records cannot give one — a strength
// session that logs sets rather than samples has no track to measure.
func TestParseFITSessionOnlyDuration(t *testing.T) {
	w := newFitWriter()
	w.define(0, msgFileID, fileIDFields)
	w.data(0, fileIDFields, []any{fileTypeActivity, fitTime(fitStart)}, nil)
	w.define(1, msgSession, sessionFields)
	w.data(1, sessionFields, []any{
		fitTime(fitStart), 10 /* training */, 20 /* strength_training */, int(2700 * scaleTime), 0, 250, 110, 140, 0,
	}, nil)

	in, err := parseFIT(w.bytes(), workout.TypeOther)
	if err != nil {
		t.Fatal(err)
	}
	if in.Duration != 2700 {
		t.Errorf("duration = %d, want 2700 from the session", in.Duration)
	}
	if in.Type != workout.TypeStrength {
		t.Errorf("type = %q, want Strength", in.Type)
	}
	if in.AvgHR != 110 || in.MaxHR != 140 {
		t.Errorf("heart rate = %d/%d, want the session's 110/140", in.AvgHR, in.MaxHR)
	}
	if !in.StartTime.Equal(fitStart) {
		t.Errorf("start = %v, want %v", in.StartTime, fitStart)
	}
}

// Every one of these is a file that exists in the wild and would otherwise be
// decoded as nonsense rather than refused or read correctly.
func TestFITEncodingEdges(t *testing.T) {
	t.Run("big endian definitions", func(t *testing.T) {
		w := newFitWriter().bigEndian()
		w.define(1, msgRecord, recordFields)
		w.data(1, recordFields, []any{
			fitTime(fitStart), degreesToSemicircles(51.5), degreesToSemicircles(-0.12),
			int((100 + 500) * scaleAltitude), 150, 85, int(3.0 * scaleSpeed), 210, 14,
		}, nil)
		msgs, err := decodeFIT(w.bytes())
		if err != nil {
			t.Fatal(err)
		}
		p, ok := fitRecord(msgs[0])
		if !ok || !p.HasLL {
			t.Fatal("a big-endian record decoded to nothing")
		}
		if math.Abs(p.Lat-51.5) > 0.0001 {
			t.Errorf("lat = %f, want 51.5 — byte order was ignored", p.Lat)
		}
		if p.HR != 150 {
			t.Errorf("hr = %d, want 150", p.HR)
		}
	})

	t.Run("compressed timestamps", func(t *testing.T) {
		fields := []wField{{recHeartRate, 1, tUint8}}
		full := []wField{{recTimestamp, 4, tUint32}, {recHeartRate, 1, tUint8}}
		w := newFitWriter()
		w.define(1, msgRecord, full)
		w.data(1, full, []any{fitTime(fitStart), 120}, nil)
		// Local type 1, five seconds on from a timestamp ending in 0.
		w.define(1, msgRecord, fields)
		base := fitTime(fitStart)
		w.compressed(1, byte((base+5)&0x1F), fields, []any{130})
		msgs, err := decodeFIT(w.bytes())
		if err != nil {
			t.Fatal(err)
		}
		if len(msgs) != 2 {
			t.Fatalf("decoded %d messages, want 2", len(msgs))
		}
		got, ok := msgs[1].timestamp(recTimestamp)
		if !ok {
			t.Fatal("a compressed-timestamp record carried no time")
		}
		if want := fitStart.Add(5 * time.Second); !got.Equal(want) {
			t.Errorf("timestamp = %v, want %v", got, want)
		}
	})

	t.Run("developer fields are stepped over", func(t *testing.T) {
		dev := []int{4, 2}
		w := newFitWriter()
		w.defineWithDev(1, msgRecord, recordFields, dev)
		w.data(1, recordFields, []any{
			fitTime(fitStart), degreesToSemicircles(51.5), degreesToSemicircles(-0.12),
			int((100 + 500) * scaleAltitude), 150, 85, int(3.0 * scaleSpeed), 210, 14,
		}, dev)
		// A second message: if the developer fields were not counted, the
		// reader is now misaligned and this one decodes as garbage or fails.
		w.data(1, recordFields, []any{
			fitTime(fitStart.Add(time.Second)), degreesToSemicircles(51.5001), degreesToSemicircles(-0.12),
			int((100 + 500) * scaleAltitude), 151, 85, int(3.0 * scaleSpeed), 211, 14,
		}, dev)
		msgs, err := decodeFIT(w.bytes())
		if err != nil {
			t.Fatal(err)
		}
		if len(msgs) != 2 {
			t.Fatalf("decoded %d messages, want 2", len(msgs))
		}
		if hr, _ := msgs[1].num(recHeartRate); hr != 151 {
			t.Errorf("second record hr = %v, want 151 — developer fields threw off the alignment", hr)
		}
	})

	t.Run("invalid values are absent, not zero", func(t *testing.T) {
		fields := []wField{{recTimestamp, 4, tUint32}, {recHeartRate, 1, tUint8}, {recTemp, 1, tSint8}}
		w := newFitWriter()
		w.define(1, msgRecord, fields)
		// 0xFF is uint8's invalid pattern, 0x7F is sint8's.
		w.data(1, fields, []any{fitTime(fitStart), 0xFF, 0x7F}, nil)
		msgs, err := decodeFIT(w.bytes())
		if err != nil {
			t.Fatal(err)
		}
		if v, ok := msgs[0].num(recHeartRate); ok {
			t.Errorf("an invalid heart rate decoded as %v", v)
		}
		if v, ok := msgs[0].num(recTemp); ok {
			t.Errorf("an invalid temperature decoded as %v", v)
		}
	})

	t.Run("signed fields keep their sign", func(t *testing.T) {
		fields := []wField{{recTimestamp, 4, tUint32}, {recTemp, 1, tSint8}}
		w := newFitWriter()
		w.define(1, msgRecord, fields)
		w.data(1, fields, []any{fitTime(fitStart), -6}, nil)
		msgs, err := decodeFIT(w.bytes())
		if err != nil {
			t.Fatal(err)
		}
		if v, _ := msgs[0].num(recTemp); v != -6 {
			t.Errorf("temperature = %v, want -6", v)
		}
	})

	t.Run("chained files", func(t *testing.T) {
		// Two complete FIT files end to end, which is how a multisport
		// activity is stored. Reading only the first loses the second sport.
		first := writeRunFIT(t)
		second := writeRunFIT(t)
		msgs, err := decodeFIT(append(append([]byte{}, first...), second...))
		if err != nil {
			t.Fatal(err)
		}
		records := 0
		for _, m := range msgs {
			if m.global == msgRecord {
				records++
			}
		}
		if records != 120 {
			t.Errorf("decoded %d records across two chained files, want 120", records)
		}
	})
}

// A device uptime is not a date. Reading one as an offset from 1989 files the
// workout in the twenty-first century's far end, where nothing will ever show
// it again.
func TestFITRejectsDeviceUptimeTimestamps(t *testing.T) {
	fields := []wField{{recTimestamp, 4, tUint32}, {recHeartRate, 1, tUint8}}
	w := newFitWriter()
	w.define(1, msgRecord, fields)
	w.data(1, fields, []any{uint32(1200), 140}, nil) // 20 minutes of uptime
	msgs, err := decodeFIT(w.bytes())
	if err != nil {
		t.Fatal(err)
	}
	if ts, ok := msgs[0].timestamp(recTimestamp); ok {
		t.Errorf("uptime 1200 decoded as the date %v", ts)
	}
}

// Not every FIT file is an activity: the same extension carries courses,
// planned workouts, settings and scale readings. Importing one of those as a
// session would produce a workout nobody did.
func TestFITRefusesNonActivityFiles(t *testing.T) {
	w := newFitWriter()
	w.define(0, msgFileID, fileIDFields)
	w.data(0, fileIDFields, []any{6 /* course */, fitTime(fitStart)}, nil)
	if _, err := parseFIT(w.bytes(), workout.TypeRun); err == nil {
		t.Fatal("a course file was imported as an activity")
	}
}

func TestFITRejectsRubbish(t *testing.T) {
	for _, c := range []struct {
		name string
		data []byte
	}{
		{"empty", nil},
		{"too short", []byte{1, 2, 3}},
		{"no signature", append([]byte{12, 0x20, 0, 0, 4, 0, 0, 0}, []byte(".XXX")...)},
	} {
		t.Run(c.name, func(t *testing.T) {
			if _, err := parseFIT(c.data, workout.TypeRun); err == nil {
				t.Error("rubbish was accepted as a FIT file")
			}
		})
	}
}

// Parse dispatches on the extension, and a file the app cannot read must say so
// rather than arriving as an empty workout.
func TestParseDispatchesFIT(t *testing.T) {
	in, err := Parse("activity.FIT", writeRunFIT(t), workout.TypeOther)
	if err != nil {
		t.Fatalf("uppercase .FIT was not recognised: %v", err)
	}
	if in.Type != workout.TypeRun {
		t.Errorf("type = %q, want Run", in.Type)
	}
}
