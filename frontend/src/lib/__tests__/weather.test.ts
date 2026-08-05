import { describe, expect, it } from 'vitest'
import { type Workout } from '../../data/workouts'
import {
  binByTemperature, describeCorrelation, describeWeather, pearson,
  temperatureCorrelation, weatherLabel,
} from '../weather'

/**
 * "Am I slower when it's hot" has a wrong answer that looks exactly like a
 * right one — a plausible line on a plausible chart, with no error anywhere.
 * That is what these cover.
 */

function run(tempC: number, over: Partial<Workout> = {}): Workout {
  return {
    id: Math.random().toString(36).slice(2),
    name: 'Run',
    type: 'Run',
    date: '2026-07-30',
    duration: 1800,
    distance: 5000,
    avgHR: 140,
    maxHR: 165,
    elevationGain: 0,
    calories: 300,
    avgPace: 300,
    avgSpeed: 12,
    route: [],
    hrTimeline: [],
    paceTimeline: [],
    elevTimeline: [],
    notes: '',
    weather: { tempC, apparentC: tempC, humidity: 50, windKph: 5, precipMm: 0, code: 0 },
    ...over,
  } as Workout
}

describe('binByTemperature', () => {
  it('averages the workouts inside each bucket', () => {
    const bins = binByTemperature(
      [run(11, { avgPace: 300 }), run(12, { avgPace: 320 }), run(13, { avgPace: 340 })],
      'pace',
    )
    expect(bins).toHaveLength(1)
    expect(bins[0].from).toBe(10)
    expect(bins[0].pace).toBe(320)
    expect(bins[0].count).toBe(3)
  })

  // A bucket of one is that workout, not an average. Drawn on the same line as
  // a bucket of forty, it invites reading one bad run as a law.
  it('drops buckets too small to be an average', () => {
    const bins = binByTemperature([...Array(3)].map(() => run(12)).concat(run(28)), 'pace')
    expect(bins.map(b => b.from)).toEqual([10])
  })

  it('puts a workout in the bucket its temperature falls in', () => {
    const bins = binByTemperature(
      [run(15), run(16), run(17), run(14.9), run(14.8), run(14.7)],
      'pace',
    )
    expect(bins.map(b => b.from)).toEqual([10, 15])
  })

  // Below freezing must not round towards zero into the wrong bucket.
  it('handles negative temperatures', () => {
    const bins = binByTemperature([run(-2), run(-3), run(-4)], 'pace')
    expect(bins[0].from).toBe(-5)
    expect(bins[0].to).toBe(0)
  })

  it('ignores workouts with no weather', () => {
    expect(binByTemperature([run(12, { weather: undefined })], 'pace')).toEqual([])
  })

  // A strength session has a temperature but no pace; averaging its zero in
  // would drag the bucket down and look like cold weather making people fast.
  it('ignores workouts with no value for the metric', () => {
    const bins = binByTemperature(
      [run(12), run(12), run(12), run(12, { avgPace: 0 })],
      'pace',
    )
    expect(bins[0].count).toBe(3)
  })

  it('returns nothing rather than throwing on an empty library', () => {
    expect(binByTemperature([], 'pace')).toEqual([])
  })
})

describe('pearson', () => {
  it('finds a perfect positive relationship', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1)
  })

  it('finds a perfect negative one', () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1)
  })

  // Null, not 0. Zero means "measured, and unrelated" — a real finding. An
  // empty or degenerate set has no finding, and rendering one as the other is
  // this view's whole failure mode.
  it('refuses to answer without enough points', () => {
    expect(pearson([], [])).toBeNull()
    expect(pearson([1], [2])).toBeNull()
    expect(pearson([1, 2], [2, 4])).toBeNull()
  })

  it('refuses to answer when one axis never varies', () => {
    expect(pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull()
    expect(pearson([1, 2, 3, 4], [7, 7, 7, 7])).toBeNull()
  })
})

describe('temperatureCorrelation', () => {
  it('reads slower-when-hot as a positive correlation with pace', () => {
    // Pace is seconds per km, so a bigger number is slower.
    const r = temperatureCorrelation(
      [run(5, { avgPace: 280 }), run(15, { avgPace: 300 }), run(25, { avgPace: 330 })],
      'pace',
    )
    expect(r).not.toBeNull()
    expect(r!).toBeGreaterThan(0.9)
  })

  it('says nothing when there is nothing to say', () => {
    expect(temperatureCorrelation([], 'pace')).toBeNull()
    expect(temperatureCorrelation([run(12, { weather: undefined })], 'hr')).toBeNull()
  })
})

describe('describeCorrelation', () => {
  // Pace is inverted — a higher number is slower — so a sign error here states
  // the exact opposite of the finding, in a confident sentence.
  it('describes a positive pace correlation as getting slower', () => {
    expect(describeCorrelation(0.7, 'pace')).toMatch(/slower/)
    expect(describeCorrelation(-0.7, 'pace')).toMatch(/faster/)
  })

  it('describes heart rate the natural way round', () => {
    expect(describeCorrelation(0.7, 'hr')).toMatch(/rise/)
    expect(describeCorrelation(-0.7, 'hr')).toMatch(/fall/)
  })

  it('does not claim a relationship that is not there', () => {
    expect(describeCorrelation(0.05, 'pace')).toMatch(/No clear relationship/)
    expect(describeCorrelation(null, 'pace')).toMatch(/Not enough/)
  })
})

describe('describeWeather', () => {
  it('leads with the temperature', () => {
    expect(describeWeather({ tempC: 12.4, apparentC: 12, humidity: 0, windKph: 0, precipMm: 0, code: 0 }))
      .toBe('12°C')
  })

  // "12°, feels 12°" is noise; the apparent temperature earns its place only
  // when it disagrees.
  it('mentions the apparent temperature only when it differs', () => {
    const same = describeWeather({ tempC: 12, apparentC: 13, humidity: 0, windKph: 0, precipMm: 0, code: 0 })
    expect(same).not.toMatch(/feels/)
    const different = describeWeather({ tempC: 12, apparentC: 6, humidity: 0, windKph: 0, precipMm: 0, code: 0 })
    expect(different).toMatch(/feels 6°/)
  })

  it('omits rain that did not fall', () => {
    const dry = describeWeather({ tempC: 12, apparentC: 12, humidity: 60, windKph: 10, precipMm: 0, code: 0 })
    expect(dry).not.toMatch(/mm/)
    const wet = describeWeather({ tempC: 12, apparentC: 12, humidity: 60, windKph: 10, precipMm: 2.4, code: 61 })
    expect(wet).toMatch(/2.4 mm/)
  })
})

describe('weatherLabel', () => {
  it('names the conditions a person would recognise', () => {
    expect(weatherLabel(0)).toBe('Clear')
    expect(weatherLabel(3)).toBe('Overcast')
    expect(weatherLabel(61)).toBe('Rain')
    expect(weatherLabel(95)).toBe('Thunderstorm')
  })
})
