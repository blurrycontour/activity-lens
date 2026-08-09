package workout

import "sort"

// Pauses: the stretches of a workout where nothing was recorded.
//
// A watch that is paused — by hand at a road crossing, or by its own auto-pause
// — stops writing samples, so a pause is a hole in the series. Everything else
// about a workout is measured; this is the one thing that has to be inferred
// from an absence, which is why the rule is deliberately narrow.
//
// Only holes count. Standing still with the watch running looks identical to
// moving very slowly, and the two are not separable from stored samples: a
// scramble up a steep pitch and a rest at the top produce the same near-zero
// speed for the same two minutes. Calling that a pause would inflate the
// average pace of exactly the workouts where the average matters most. The
// device already made this judgement when it decided to stop recording, and
// deferring to it is the only version of this that cannot invent a pause.

// A gap must be at least this long to be a pause, however slowly the device was
// sampling. Below this it is a dropped sample or a moment of lost signal, and a
// workout is not usefully described as having paused for eight seconds.
const minPauseSec = 20

// …and at least this many times the workout's usual sampling interval.
//
// The absolute floor alone would be wrong for a device using smart recording,
// which writes a point only when something changes and can legitimately leave
// half a minute of straight, steady road unsampled. Scaling by the rhythm the
// file actually has adapts to one-second, five-second and variable recording
// without a list of devices to keep up to date.
const pauseGapFactor = 8

// Below this many samples there is no rhythm to measure, so there is nothing to
// call unusual. A handful of points is a manually entered workout or a file
// recorded once a minute; either way, guessing is worse than saying nothing.
const minSamplesForPauses = 20

// sampleTimes returns every second at which this workout recorded something,
// in order and without repeats.
//
// The pace timeline is deliberately excluded. It is not a record of when the
// device sampled: it is derived over a moving window that only closes once
// enough time or ground has passed, so its gaps are a property of how pace is
// computed and would read as pauses on any slow workout.
func sampleTimes(w *Workout) []int {
	seen := make(map[int]struct{}, len(w.HRTimeline)+len(w.ElevTimeline)+len(w.CadenceTimeline))
	for _, p := range w.HRTimeline {
		seen[p.T] = struct{}{}
	}
	for _, p := range w.ElevTimeline {
		seen[p.T] = struct{}{}
	}
	for _, p := range w.CadenceTimeline {
		seen[p.T] = struct{}{}
	}
	out := make([]int, 0, len(seen))
	for t := range seen {
		out = append(out, t)
	}
	sort.Ints(out)
	return out
}

// medianGap returns the typical spacing between consecutive samples.
//
// The median and not the mean, because the mean of a series containing the very
// pauses we are looking for is dragged upward by them — the threshold would
// then rise with the number of pauses and the largest ones would hide behind
// their own effect on it.
func medianGap(times []int) int {
	if len(times) < 2 {
		return 0
	}
	gaps := make([]int, 0, len(times)-1)
	for i := 1; i < len(times); i++ {
		gaps = append(gaps, times[i]-times[i-1])
	}
	sort.Ints(gaps)
	return gaps[len(gaps)/2]
}

// DetectPauses returns the stretches of a workout in which nothing was
// recorded, in order.
//
// Returns nil rather than an empty slice when there is nothing to say, so
// "no pauses" and "not enough data to tell" both serialise away — the caller
// distinguishes them through MovingTime, which is only ever set alongside a
// successful pass.
func DetectPauses(w *Workout) []Pause {
	times := sampleTimes(w)
	if len(times) < minSamplesForPauses {
		return nil
	}
	median := medianGap(times)
	threshold := minPauseSec
	if scaled := median * pauseGapFactor; scaled > threshold {
		threshold = scaled
	}

	var out []Pause
	for i := 1; i < len(times); i++ {
		if times[i]-times[i-1] < threshold {
			continue
		}
		out = append(out, Pause{From: times[i-1], To: times[i]})
	}
	return out
}

// PausedSeconds totals the time spent paused.
func PausedSeconds(pauses []Pause) int {
	total := 0
	for _, p := range pauses {
		if p.To > p.From {
			total += p.To - p.From
		}
	}
	return total
}

// MovingSeconds returns the part of a workout's elapsed time that was actually
// recorded.
//
// Falls back to the elapsed duration whenever the pauses do not make sense
// against it — a corrupt series, or a file whose timestamps run past its own
// stated duration. A moving time longer than the workout, or a negative one,
// would propagate into pace and speed as a figure nobody could account for.
func MovingSeconds(duration int, pauses []Pause) int {
	moving := duration - PausedSeconds(pauses)
	if moving <= 0 || moving > duration {
		return duration
	}
	return moving
}
