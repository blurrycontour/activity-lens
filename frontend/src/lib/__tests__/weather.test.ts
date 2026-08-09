import { describe, expect, it } from 'vitest'
import { type Workout } from '../../data/workouts'
import {
  PERF_METRICS, WEATHER_FIELDS, WEATHER_ROWS, binByTemperature, binWidthFor, describeCorrelation,
  linearFit, weatherScatter,
  formatWeatherValue, pearson, temperatureCorrelation, weatherLabel,
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
      'pace', 5,
    )
    expect(bins).toHaveLength(1)
    expect(bins[0].from).toBe(10)
    expect(bins[0].pace).toBe(320)
    expect(bins[0].count).toBe(3)
  })

  // A bucket of one is that workout, not an average. Drawn on the same line as
  // a bucket of forty, it invites reading one bad run as a law.
  it('drops buckets too small to be an average', () => {
    const bins = binByTemperature([...Array(3)].map(() => run(12)).concat(run(28)), 'pace', 5)
    expect(bins.map(b => b.from)).toEqual([10])
  })

  it('puts a workout in the bucket its temperature falls in', () => {
    const bins = binByTemperature(
      [run(15), run(16), run(17), run(14.9), run(14.8), run(14.7)],
      'pace', 5,
    )
    expect(bins.map(b => b.from)).toEqual([10, 15])
  })

  // Below freezing must not round towards zero into the wrong bucket.
  it('handles negative temperatures', () => {
    const bins = binByTemperature([run(-2), run(-3), run(-4)], 'pace', 5)
    expect(bins[0].from).toBe(-5)
    expect(bins[0].to).toBe(0)
  })

  it('ignores workouts with no weather', () => {
    expect(binByTemperature([run(12, { weather: undefined })], 'pace', 5)).toEqual([])
  })

  // A strength session has a temperature but no pace; averaging its zero in
  // would drag the bucket down and look like cold weather making people fast.
  it('ignores workouts with no value for the metric', () => {
    const bins = binByTemperature(
      [run(12), run(12), run(12), run(12, { avgPace: 0 })],
      'pace', 5,
    )
    expect(bins[0].count).toBe(3)
  })

  it('returns nothing rather than throwing on an empty library', () => {
    expect(binByTemperature([], 'pace', 5)).toEqual([])
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

// A fixed 5 °C band is two bars for someone who trains between 18 and 28 °C
// all year, which is not a chart. Width has to follow the spread present.
describe('binWidthFor', () => {
  it('resolves a narrow range finely', () => {
    expect(binWidthFor([run(18), run(22), run(26), run(28)], 'pace')).toBe(2)
    expect(binWidthFor([run(19), run(20), run(21), run(22)], 'pace')).toBe(1)
  })

  it('does not shatter a wide range into noise', () => {
    expect(binWidthFor([run(-10), run(0), run(15), run(30)], 'pace')).toBe(5)
    expect(binWidthFor([run(-20), run(0), run(30), run(60)], 'pace')).toBe(10)
  })

  // Every candidate width divides its bounds evenly, so a band is always
  // something a person can read off the axis.
  it('only ever picks a round width', () => {
    for (const temps of [[1, 2, 3], [1, 40], [5, 5.5], [-30, 50]]) {
      expect([1, 2, 5, 10]).toContain(binWidthFor(temps.map(t => run(t)), 'pace'))
    }
  })

  it('answers for an empty set rather than throwing', () => {
    expect(binWidthFor([], 'pace')).toBe(10)
    expect(binWidthFor([run(12, { weather: undefined })], 'pace')).toBe(10)
  })

  // The whole point of adapting: a set that produced two usable bands at a
  // fixed 5 °C produces a real curve now.
  it('turns a mild climate into a chart instead of two bars', () => {
    const mild = [20, 20, 20, 21, 21, 21, 22, 22, 22, 23, 23, 23, 24, 24, 24].map(t => run(t))
    expect(binByTemperature(mild, 'pace', 5)).toHaveLength(1)
    expect(binByTemperature(mild, 'pace')).toHaveLength(5)
  })
})

describe('formatWeatherValue', () => {
  const field = (key: string) => WEATHER_FIELDS.find(f => f.key === key)!
  const w = { tempC: 12.4, apparentC: 9.6, humidity: 68, windKph: 14.2, precipMm: 0, code: 0 }

  it('rounds each value to the precision that field deserves', () => {
    expect(formatWeatherValue(field('tempC'), w)).toBe('12 °C')
    expect(formatWeatherValue(field('windKph'), w)).toBe('14 km/h')
    // Rain is the one value where a tenth of a unit is the difference between
    // a dry run and a wet one.
    expect(formatWeatherValue(field('precipMm'), { ...w, precipMm: 0.4 })).toBe('0.4 mm')
  })

  // The panel previously dropped a rain of 0 and an apparent temperature that
  // agreed with the air, leaving a reader unable to tell "none" from "unknown".
  it('states a zero rather than leaving it out', () => {
    expect(formatWeatherValue(field('precipMm'), w)).toBe('0.0 mm')
    expect(formatWeatherValue(field('apparentC'), { ...w, apparentC: 12.4 })).toBe('12 °C')
  })

  it('keeps the percent sign tight against its number', () => {
    expect(formatWeatherValue(field('humidity'), w)).toBe('68%')
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

/*
 * The rows are what the card lays out, and the fields are what it reads values
 * from. They were separate lists once before and drifted into a panel showing
 * four values while the editor offered five.
 */
describe('WEATHER_ROWS', () => {
  it('lays out every field exactly once', () => {
    const laid = WEATHER_ROWS.flat()
    expect([...laid].sort()).toEqual(WEATHER_FIELDS.map(f => f.key).sort())
  })

  it('keeps the two temperatures on the same row', () => {
    const row = WEATHER_ROWS.find(r => r.includes('tempC'))
    expect(row).toContain('apparentC')
  })

  // Each reading is its own tooltip; a field with nothing to say would be a
  // trigger that opens an empty bubble.
  it('gives every field something to explain', () => {
    for (const f of WEATHER_FIELDS) expect(f.hint.length).toBeGreaterThan(20)
  })
})

/*
 * The free-choice chart. Both of these draw something plausible from wrong
 * arithmetic, which is why they are tested rather than eyeballed.
 */
describe('weatherScatter', () => {
  it('drops workouts missing either side of the pair', () => {
    const metric = PERF_METRICS.find(m => m.key === 'hr')!
    const pts = weatherScatter(
      [
        run(12, { avgHR: 150 }),
        // No weather at all.
        run(12, { avgHR: 150, weather: undefined }),
        // No strap: stored as 0, which is an absence and not a heart rate.
        run(12, { avgHR: 0 }),
      ],
      'tempC',
      metric,
    )
    expect(pts).toHaveLength(1)
    expect(pts[0]).toMatchObject({ x: 12, y: 150 })
  })

  // Elevation is the one figure whose zero is real: a flat run climbed nothing.
  it('keeps a zero elevation gain', () => {
    const metric = PERF_METRICS.find(m => m.key === 'elevation')!
    expect(weatherScatter([run(12, { elevationGain: 0 })], 'tempC', metric)).toHaveLength(1)
  })
})

describe('linearFit', () => {
  const pt = (x: number, y: number) => ({ x, y, name: 'w', date: '2025-01-01' })

  it('recovers a line the points lie on', () => {
    const fit = linearFit([pt(0, 1), pt(1, 3), pt(2, 5), pt(3, 7)])
    expect(fit).not.toBeNull()
    expect(fit![0]).toMatchObject({ x: 0 })
    expect(fit![0].y).toBeCloseTo(1, 6)
    expect(fit![1]).toMatchObject({ x: 3 })
    expect(fit![1].y).toBeCloseTo(7, 6)
  })

  // A line through two points is those two points, not a trend.
  it('refuses fewer than three points', () => {
    expect(linearFit([pt(0, 1), pt(1, 3)])).toBeNull()
  })

  // Every workout at the same humidity: the slope is a division by zero, and
  // the line it would draw is vertical and meaningless.
  it('refuses points with no spread on x', () => {
    expect(linearFit([pt(5, 1), pt(5, 3), pt(5, 9)])).toBeNull()
  })
})
