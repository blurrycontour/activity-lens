import type React from 'react'
import { useLayoutEffect, useMemo } from 'react'
import { ALL_WORKOUT_TYPES, TYPE_COLOR, fmtDuration, fmtPace, type WorkoutType, type Workout } from '../data/workouts'
import { dayMonth, fromDateKey, shortDate } from '../lib/date'
import { centreInScroller, useEdgeFades } from '../lib/useEdgeFades'
import { useWorkouts } from '../context/WorkoutsContext'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import ChartCard, { EmptyPlot } from '../components/ChartCard'
import TabStrip from '../components/TabStrip'
import InfoTip from '../components/InfoTip'
import { EDGE_PADDING_Y, END_PADDING, KEEP_EMPTY_ROWS, denseXAxis, useChartSpace, xLabel } from '../components/ChartAxis'
import TypeLegend from '../components/TypeLegend'
import ScatterDot, { ActiveScatterDot } from '../components/ScatterDot'
import Dropdown from '../components/Dropdown'
import { useLocalStorage } from '../lib/useLocalStorage'
import { filterByRange, rangeLabel, toDateKey } from '../lib/range'
import { everyDayBetween, everyMonthBetween, everyWeekBetween, fillGaps, keySpan } from '../lib/timeGaps'
import { AXIS_TICK, DATA_LINE, GRID_PROPS, HOVER_FILL, SERIES_COLORS, TREND_LINE } from '../lib/chartColors'
import {
  PERF_METRICS, WEATHER_FIELDS, binByTemperature, binWidthFor, describeCorrelation,
  MIN_CORRELATION_POINTS, hasUsableWeather, linearFit, pearson, temperatureCorrelation, weatherScatter,
  type PerfKey, type WeatherKey, type WeatherMetric,
} from '../lib/weather'
import { usePreferences } from '../context/PreferencesContext'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell, LineChart, Line, ComposedChart, ReferenceArea, ReferenceLine,
} from 'recharts'
import { Award, Target, Zap, Activity, Navigation, TrendingUp, Gauge, Flame, CloudSun, Sparkles, CalendarRange, ChevronLeft, ChevronRight } from 'lucide-react'

type PR = { longest: Workout; longestTime: Workout; fastest: Workout | null; highest: Workout }

type TabId = 'records' | 'trends' | 'efficiency' | 'load' | 'weather'

const TABS: { id: TabId; label: string; icon: React.ReactNode; blurb: string }[] = [
  { id: 'records', label: 'Records', icon: <Award size={15} />, blurb: 'Your best single activity in each category, per sport.' },
  { id: 'trends', label: 'Trends', icon: <TrendingUp size={15} />, blurb: 'How each measure has moved over time, and how much you did.' },
  { id: 'efficiency', label: 'Efficiency', icon: <Gauge size={15} />, blurb: 'Whether the same effort is buying you more speed than it used to.' },
  { id: 'load', label: 'Load', icon: <Flame size={15} />, blurb: 'How hard you have been training lately, and whether that is sustainable.' },
  { id: 'weather', label: 'Weather', icon: <CloudSun size={15} />, blurb: 'What heat and humidity do to your pace and heart rate.' },
]

type Metric = 'pace' | 'hr' | 'maxHr' | 'distance' | 'duration' | 'elevation' | 'calories' | 'speed' | 'steps'

const METRICS: { id: Metric; label: string; color: string; unit: string; format?: (v: number) => string }[] = [
  /* Not var(--primary). Every other entry here is a fixed hue, so the accent was
     the one series whose colour moved when the reader changed a setting — and it
     moved *onto* its neighbours: Electric Blue is Distance, Violet is Duration,
     Vivid Orange is Calories. Two selected metrics could come out the same. */
  { id: 'pace', label: 'Avg Pace', color: 'var(--run)', unit: '/km', format: fmtPace },
  { id: 'hr', label: 'Avg HR', color: 'var(--danger)', unit: 'bpm' },
  /* Derived from the average-HR red rather than given a hue of its own: the two
     are the same measurement, and a chart showing both should say so. A literal
     #f97316 sat here before, which followed neither the theme nor the family. */
  { id: 'maxHr', label: 'Max HR', color: 'color-mix(in srgb, var(--danger) 60%, var(--warning))', unit: 'bpm' },
  { id: 'distance', label: 'Distance', color: 'var(--blue)', unit: 'km', format: v => (v / 1000).toFixed(1) },
  { id: 'duration', label: 'Duration', color: 'var(--purple)', unit: 'min', format: v => Math.round(v / 60).toString() },
  { id: 'elevation', label: 'Elevation Gain', color: 'var(--hike)', unit: 'm' },
  { id: 'calories', label: 'Calories', color: 'var(--accent)', unit: 'kcal' },
  { id: 'speed', label: 'Avg Speed', color: 'var(--swim)', unit: 'km/h', format: v => v.toFixed(1) },
  { id: 'steps', label: 'Steps', color: 'var(--strength)', unit: '', format: v => Math.round(v).toLocaleString() },
]

/**
 * What the by-sport chart can measure, and how each reads.
 *
 * Deliberately the four that are comparable across sports as a bare number. A
 * pace or a heart rate is not — "best pace" for a swim and a ride are different
 * quantities wearing the same units — and those already live on the record
 * cards above, per sport, where the comparison is never implied.
 */
type SportMeasure = 'distance' | 'duration' | 'elevation' | 'calories'

const SPORT_MEASURES: {
  id: SportMeasure
  label: string
  axis: string
  of: (w: Workout) => number
  fmt: (v: number) => string
}[] = [
  { id: 'distance', label: 'Distance', axis: 'Distance (km)', of: w => w.distance / 1000, fmt: v => `${v.toFixed(1)} km` },
  { id: 'duration', label: 'Time', axis: 'Time (hours)', of: w => w.duration / 3600, fmt: v => `${v.toFixed(1)} h` },
  { id: 'elevation', label: 'Elevation', axis: 'Elevation gain (m)', of: w => w.elevationGain, fmt: v => `${Math.round(v)} m` },
  { id: 'calories', label: 'Calories', axis: 'Calories (kcal)', of: w => w.calories, fmt: v => `${Math.round(v).toLocaleString()} kcal` },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** TSS-equivalent for one workout: duration scaled by relative heart-rate effort. */
function loadOf(w: Workout): number {
  return Math.round(w.duration / 3600 * w.avgHR / 150 * 100)
}

/** Sortable key for the Monday-anchored week a YYYY-MM-DD date falls in. */
function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toDateKey(d)
}

function monthLabel(key: string): string {
  const [yr, mo] = key.split('-')
  return `${MONTH_NAMES[Number(mo) - 1]} ${yr.slice(2)}`
}

/**
 * Axis label for a day: "Jul 27", or "Jul 27 '26" when the year has to be said.
 *
 * Said on as few ticks as possible. A year on every tick made the labels half
 * again as long, which pushed them into each other and left the axis looking
 * broken — and it is redundant on all but one of them anyway, since a run of
 * dates only changes year once. Callers mark that one tick; the rest stay short
 * and the tooltip carries the full date regardless.
 */
function dayLabel(date: string, withYear = false): string {
  const d = new Date(`${date}T00:00:00`)
  const short = dayMonth(d)
  return withYear ? `${short} '${String(d.getFullYear()).slice(2)}` : short
}

/**
 * Marks which of `keys` should carry a year: the first, and any that starts a
 * new one. Returns an all-false set when the range never leaves a single year.
 */
function yearMarks(keys: string[]): boolean[] {
  if (!spansYears(keys)) return keys.map(() => false)
  let prev = ''
  return keys.map(k => {
    const year = k.slice(0, 4)
    const mark = year !== prev
    prev = year
    return mark
  })
}

/** Tooltip form. Always names the year: there is room, and it settles it. */
function fullDate(date: string): string {
  return fromDateKey(date).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

/** Whether a set of YYYY-... keys covers more than one calendar year. */
function spansYears(keys: string[]): boolean {
  if (keys.length === 0) return false
  const first = keys[0].slice(0, 4)
  return keys.some(k => k.slice(0, 4) !== first)
}

/** A chart row anchored to an activity date; the rest varies per chart. */
type DatedRow = { date: string; dateLabel: string; dateFull: string } & Record<string, unknown>

/**
 * The longest span, in days, worth giving one axis position per day.
 *
 * A phone leaves the plot around 310px. At a year and a bit that is under a
 * pixel a day, which is the point past which the spacing stops saying anything
 * — and past which Recharts stops resolving the pointer correctly: at two and a
 * half years the tooltip on an 800-slot axis reported dates a year out, cycling
 * back on itself three times across the width. A slot nobody can see and the
 * chart cannot address is worse than no slot.
 *
 * Chosen just above a year so the "Last year" range always fills, since that is
 * the longest range anyone reads day by day.
 */
const MAX_DAY_SLOTS = 370

/** Whether a span is short enough to give every day its own axis position. */
function fitsDaySlots(first: string, last: string): boolean {
  return (fromDateKey(last).getTime() - fromDateKey(first).getTime()) / 86400000 <= MAX_DAY_SLOTS
}

/** True when Gaps is on and the span is too long to honour it by day. */
function gapsTooWide(rows: DatedRow[]): boolean {
  const span = keySpan(rows, r => r.date)
  return !!span && !fitsDaySlots(span[0], span[1])
}

/**
 * Gives a per-activity series one position per day between its first and last
 * activity, so time off shows as the distance it actually is.
 *
 * An inserted day carries only its date, leaving every value undefined. The
 * lines that draw these series pass `connectNulls`, so the line carries across
 * the gap while the x axis stops pretending the gap was not there.
 *
 * Above MAX_DAY_SLOTS the rows come back untouched — see there.
 */
function withEmptyDays(rows: DatedRow[]): DatedRow[] {
  const span = keySpan(rows, r => r.date)
  if (!span || !fitsDaySlots(span[0], span[1])) return rows
  const filled = fillGaps(
    rows,
    everyDayBetween(span[0], span[1]),
    r => r.date,
    // `empty` marks a day the gap filler inserted, so a tooltip can say "no
    // activity" rather than rendering nothing and looking broken.
    date => ({ date, dateLabel: dayLabel(date), dateFull: fullDate(date), empty: true }),
  )
  // Re-marked over the filled run: the day that opens a year is usually one of
  // the inserted ones, and the original marks now sit on the wrong rows.
  const marks = yearMarks(filled.map(r => r.date))
  return filled.map((r, i) => ({ ...r, dateLabel: dayLabel(r.date, marks[i]) }))
}

/**
 * The separator between a row's position and its printed date in an axis key.
 * A middot: `dayLabel` builds dates out of digits, letters and an apostrophe,
 * and never one of these.
 */
const SLOT_SEP = '\u00b7'

/**
 * One axis slot per row, rather than one per distinct date.
 *
 * These series are one row per activity and the x axis is a *category* axis
 * keyed on the printed date — so two activities on one day were one category.
 * Recharts still drew both dots, because the band domain keeps duplicates, but
 * it builds its tooltip ticks from the distinct values: on a 90-day selection
 * with seven doubled-up days that was 22 points over 15 slots, and the second
 * activity of every shared day had nothing to hover. Pointing at it answered
 * for the first one and highlighted the first one, while the cursor line
 * tracked the pointer — which reads as "the tooltip is stuck one point back".
 *
 * It looked like a right-edge fault because the last day was one of the
 * doubled ones. It was never about the edge.
 *
 * The row's position is what makes the key unique; `slotLabel` puts the date
 * back on the tick, so the axis reads exactly as it did.
 */
function withSlots<T extends DatedRow>(rows: T[]): T[] {
  return rows.map((row, i) => ({ ...row, axisKey: `${i}${SLOT_SEP}${row.dateLabel}` }))
}

/**
 * Which slots get a tick: the first of each distinct day.
 *
 * Slots and ticks stopped being the same thing the moment a day could hold two
 * of them, and only the slots need to be per-row. Left to itself the axis put
 * a tick on every slot and printed "Jul 30" twice in a row; blanking the
 * repeat was worse, because a zero-width label always survives the collision
 * pass and so the blanks crowded out real dates and left the axis ending on
 * nothing.
 *
 * Passed as `ticks`, which the interval logic still thins to what fits — so
 * the labels come out exactly as they did before any of this.
 */
function dayTicks(rows: DatedRow[]): string[] {
  const out: string[] = []
  let last: string | null = null
  for (const row of rows) {
    if (row.dateLabel !== last) {
      out.push(row.axisKey as string)
      last = row.dateLabel
    }
  }
  return out
}

/** The printed date out of an axis key made by `withSlots`. */
function slotLabel(key: unknown): string {
  const s = String(key ?? '')
  const at = s.indexOf(SLOT_SEP)
  return at < 0 ? s : s.slice(at + 1)
}

/**
 * The first payload entry that describes a real point rather than a fitted one.
 *
 * These charts draw a scatter of workouts and a line fitted through them, and
 * the fitted line's points carry only coordinates. Reading `payload[0]` blindly
 * therefore produced a tooltip for the *line* whenever the pointer was nearer
 * to it than to a dot — and since a fit runs right through the middle of its
 * own dots, that was most of the time. The tooltip then rendered nothing, which
 * looks exactly like a tooltip that does not work: the cursor line appears and
 * no card follows.
 */
function realPoint(payload: readonly { payload?: Record<string, unknown> }[]): Record<string, unknown> | null {
  for (const entry of payload) {
    const d = entry.payload
    // A truthy name, not merely a present one. `from` is a bin's lower bound
    // and may legitimately be 0, so that half tests for presence instead.
    if (d && (d.name || d.from != null)) return d
  }
  return null
}

/**
 * Which measures the Trends charts draw.
 *
 * One scrolling row rather than a wrapping block. Nine chips come to 893px of
 * labels, which on a phone wrapped to three rows and 102px — a quarter of the
 * screen spent on a control, above the summary tiles and the chart it belongs
 * to, so the chart itself barely cleared the fold.
 *
 * The same scroller the tab strip is: it fades at whichever end still has
 * something past it, which is the only on-screen evidence that there is more,
 * and it scrolls the first selected chip into view so returning to the tab
 * shows what you picked rather than the start of the list. The swipe pager
 * already yields to horizontal scrollers, so this does not cost a page swipe.
 */
function MetricChips({ selected, onToggle }: {
  selected: Metric[]
  onToggle: (id: Metric) => void
}) {
  const { ref, fadeClass, edges, measure, scrollByPage } = useEdgeFades<HTMLDivElement>()

  // Before paint, so the row never appears scrolled to the wrong place. Only
  // on mount and when the selection changes from elsewhere — not on every
  // toggle, or tapping a chip would drag the row out from under the finger.
  useLayoutEffect(() => {
    centreInScroller(ref.current, ref.current?.querySelector<HTMLElement>('.metric-chip.on') ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="metric-chips-wrap">
      <div ref={ref} className={`metric-chips${fadeClass}`} onScroll={measure} role="group" aria-label="Measures">
        {METRICS.map(m => {
          const on = selected.includes(m.id)
          return (
            <button
              key={m.id}
              className={`metric-chip${on ? ' on' : ''}`}
              onClick={() => onToggle(m.id)}
              aria-pressed={on}
              /* The measure's own colour, which is the line's colour on the
                 chart below — the one thing here that cannot come from a
                 token, because it is per measure. */
              style={{ '--chip-hue': m.color } as React.CSSProperties}
            >
              <span className="metric-chip-dot" aria-hidden />
              {m.label}
            </button>
          )
        })}
      </div>
      {/* An arrow at each live end, because the fade was not saying it. It
          dissolves a chip's outline into the background, and an outline is
          what the end of a row looks like anyway — so four chips and a sliver
          read as four chips. These say it outright and can be pressed.
          Always rendered and faded out when there is nothing that way, rather
          than mounted and unmounted: an arrow appearing under a finger that is
          already moving is worse than one that is simply not lit. */}
      <button
        className={`chip-scroll start${edges.start ? '' : ' off'}`}
        onClick={() => scrollByPage(-1)}
        tabIndex={edges.start ? 0 : -1}
        aria-hidden={!edges.start}
        aria-label="Show earlier measures"
      >
        <ChevronLeft size={15} />
      </button>
      <button
        className={`chip-scroll end${edges.end ? '' : ' off'}`}
        onClick={() => scrollByPage(1)}
        tabIndex={edges.end ? 0 : -1}
        aria-hidden={!edges.end}
        aria-label="Show more measures"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  )
}

/** Two-option segmented control used by the volume chart's toggles. */
function Segmented<T extends string>({ value, onChange, options }: {
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string }[]
}) {
  return (
    <div className="segmented">
      {options.map(o => (
        <button
          key={o.id}
          className={value === o.id ? 'active' : undefined}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default function Analysis() {
  const { workouts: allWorkouts } = useWorkouts()
  const [tab, setTab] = useLocalStorage<TabId>('al_an_tab', 'records')
  const [rangeDays, setRangeDays] = useLocalStorage<number>('al_an_range', 30)
  const [typeFilter, setTypeFilter] = useLocalStorage<WorkoutType | 'All'>('al_an_type', 'All')
  const [selectedMetrics, setSelectedMetrics] = useLocalStorage<Metric[]>('al_tl_metrics', ['pace', 'hr'])
  const [volumeBucket, setVolumeBucket] = useLocalStorage<'week' | 'month'>('al_tl_bucket', 'week')
  const [volumeMeasure, setVolumeMeasure] = useLocalStorage<'distance' | 'time'>('al_tl_vol', 'distance')
  /**
   * Whether time-series charts span real elapsed time.
   *
   * Off by default, which is how these charts have always drawn: one position
   * per activity, gaps closed up. That is the denser and often more readable
   * view — but it silently rescales the x axis, so a fortnight off looks like
   * business as usual. On, every skipped day or bucket keeps its place.
   *
   * On by default, which it was not. Off, these charts put one point per
   * activity on a categorical axis *labelled with dates*: eight days between
   * two workouts and one day between the next two came out the same width, so
   * the shape of the line — which is the entire product of a page captioned
   * "falling is improving" — was an artefact of how many times you trained
   * rather than of when. A reader has no way to know that from looking, and a
   * chart whose default reading is wrong is worse than a denser one.
   *
   * Still a toggle, because the compressed view is genuinely the better one
   * for comparing activity to activity. It is now the thing you opt into.
   */
  const [showGaps, setShowGaps] = useLocalStorage<boolean>('al_an_gaps', true)
  /**
   * Whether the trend chart's y axis starts at zero or hugs the data.
   *
   * Both are honest and neither is the right default for every metric: from
   * zero keeps the proportions truthful, which matters for distance; fitting
   * the data is the only way to see a trend in heart rate, where every value
   * sits in a narrow band a long way above zero.
   */
  const [trendYAxis, setTrendYAxis] = useLocalStorage<'fit' | 'zero'>('al_tl_yaxis', 'fit')
  const [sportMeasure, setSportMeasure] = useLocalStorage<SportMeasure>('al_an_sport_measure', 'calories')
  const [sportAgg, setSportAgg] = useLocalStorage<'total' | 'best'>('al_an_sport_agg', 'total')
  const [weatherMetric, setWeatherMetric] = useLocalStorage<WeatherMetric>('al_an_wx_metric', 'pace')
  const [exploreX, setExploreX] = useLocalStorage<WeatherKey>('al_an_wx_x', 'humidity')
  const [exploreY, setExploreY] = useLocalStorage<PerfKey>('al_an_wx_y', 'pace')
  const { prefs } = usePreferences()
  const space = useChartSpace()

  // One filter pair governs the whole page, so a question only has to be asked
  // once rather than re-scoped on every tab.
  const inRange = useMemo(() => filterByRange(allWorkouts, rangeDays), [allWorkouts, rangeDays])
  const workouts = useMemo(
    () => typeFilter === 'All' ? inRange : inRange.filter(w => w.type === typeFilter),
    [inRange, typeFilter],
  )

  // ── Weather ──────────────────────────────────────────────────────────────
  //
  /*
   * One series per activity type, never one series across them.
   *
   * A run and a ride report pace in the same units and mean nothing like the
   * same thing, so a single line over both plots the ratio of one to the other
   * at each temperature rather than anything about temperature. That much has
   * always been true; what was wrong was the answer to it. "All types" used to
   * quietly chart runs, which reads as a broken filter, and as an empty page to
   * anyone who does not run.
   *
   * So everything is drawn, split by type and coloured by it — the same colours
   * the badges and the rest of the app use, so no legend has to teach them. A
   * ride's dots and a run's dots share an axis and never share a line, which is
   * the distinction that actually matters: you can see all of your training at
   * once without any two sports being averaged together.
   *
   * A specific page filter still narrows it to one group, so this is one code
   * path rather than a special case bolted onto a general one.
   */
  const weatherTypes = useMemo(() => {
    const counts = new Map<WorkoutType, number>()
    for (const w of inRange) {
      if (typeFilter !== 'All' && w.type !== typeFilter) continue
      if (hasUsableWeather(w, weatherMetric)) counts.set(w.type, (counts.get(w.type) ?? 0) + 1)
    }
    // Busiest first, so the type most of the library is made of is the one the
    // eye lands on and the first colour in the caption.
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type)
  }, [inRange, typeFilter, weatherMetric])

  const weatherPool = useMemo(
    () => inRange.filter(w => weatherTypes.includes(w.type) && hasUsableWeather(w, weatherMetric)),
    [inRange, weatherTypes, weatherMetric],
  )
  // Band width follows the spread actually present: a mild climate that never
  // leaves 18–28 °C would get two bands at a fixed 5 °C, which is not a chart.
  // Taken over everything rather than per type, so the bands line up across
  // the groups and two lines can be read against each other.
  const binWidth = useMemo(
    () => binWidthFor(weatherPool, weatherMetric),
    [weatherPool, weatherMetric],
  )
  /** Everything each type contributes to the temperature chart. */
  const weatherGroups = useMemo(
    () => weatherTypes.map(type => {
      const pool = weatherPool.filter(w => w.type === type)
      return {
        type,
        color: TYPE_COLOR[type],
        count: pool.length,
        bins: binByTemperature(pool, weatherMetric, binWidth).map(b => ({
          temp: (b.from + b.to) / 2, value: b[weatherMetric], from: b.from, to: b.to, count: b.count, type,
        })),
        scatter: pool.map(w => ({
          temp: w.weather!.tempC,
          value: weatherMetric === 'pace' ? w.avgPace : w.avgHR,
          name: w.name,
          type,
        })),
        r: temperatureCorrelation(pool, weatherMetric),
      }
    }),
    [weatherTypes, weatherPool, weatherMetric, binWidth],
  )
  // ── Free-choice comparison ───────────────────────────────────────────────
  //
  // Split by type for the same reason and no binning: across fifteen
  // combinations most buckets would hold one workout, and a line through those
  // states far more than the data does.
  const exploreField = WEATHER_FIELDS.find(f => f.key === exploreX) ?? WEATHER_FIELDS[0]
  const exploreMetric = PERF_METRICS.find(m => m.key === exploreY) ?? PERF_METRICS[0]
  /*
   * Every sport's dots in one array.
   *
   * The chart draws one Scatter over this rather than one per sport, because
   * Recharts gives each series its own tooltip and only one of them ever
   * answered a tap. The colour moves to a Cell per point, which is what the
   * Efficiency scatters already do.
   */
  const weatherDots = useMemo(() => weatherGroups.flatMap(g => g.scatter), [weatherGroups])

  const exploreGroups = useMemo(
    () => weatherTypes.map(type => {
      const points = weatherScatter(
        inRange.filter(w => w.type === type), exploreField.key, exploreMetric,
      ).map(p => ({ ...p, type }))
      return {
        type,
        color: TYPE_COLOR[type],
        points,
        fit: linearFit(points),
        r: pearson(points.map(p => p.x), points.map(p => p.y)),
      }
    }).filter(g => g.points.length > 0),
    [weatherTypes, inRange, exploreField, exploreMetric],
  )
  const explorePoints = useMemo(
    () => exploreGroups.flatMap(g => g.points),
    [exploreGroups],
  )

  // Anything at all, regardless of the current filters — the difference between
  // "no weather yet" and "none in this window" is the whole empty state.
  const anyWeather = useMemo(() => allWorkouts.some(w => w.weather), [allWorkouts])

  // ── Records ──────────────────────────────────────────────────────────────
  const { PRs } = useMemo(() => {
    const PRs: Partial<Record<WorkoutType, PR>> = {}
    for (const type of ['Run', 'Ride', 'Hike', 'Swim', 'Strength'] as WorkoutType[]) {
      const tw = workouts.filter(w => w.type === type)
      if (tw.length === 0) continue
      const paced = tw.filter(w => w.avgPace)
      PRs[type] = {
        longest: tw.reduce((a, b) => a.distance > b.distance ? a : b),
        // The one record every sport can set. Strength work has no distance and
        // no climb, so without this its card had three rows and two of them
        // read zero — the card meant to show your best, showing nothing.
        longestTime: tw.reduce((a, b) => a.duration > b.duration ? a : b),
        fastest: paced.length > 0 ? paced.reduce((a, b) => a.avgPace < b.avgPace ? a : b) : null,
        highest: tw.reduce((a, b) => a.elevationGain > b.elevationGain ? a : b),
      }
    }
    return { PRs }
  }, [workouts])

  /**
   * One bar per sport, for whichever measure and aggregate are selected.
   *
   * Coloured via Cell. A separate <Bar> per type would create one series each
   * and leave every bar offset in its own slot rather than centred on its
   * category.
   */
  const bySport = useMemo(() => {
    const m = SPORT_MEASURES.find(x => x.id === sportMeasure)!
    return ALL_WORKOUT_TYPES.map(t => {
      const of = workouts.filter(w => w.type === t)
      if (of.length === 0) return null
      const values = of.map(m.of)
      return {
        type: t,
        value: sportAgg === 'best' ? Math.max(...values) : values.reduce((a, b) => a + b, 0),
        count: of.length,
        fill: TYPE_COLOR[t],
      }
    }).filter((d): d is NonNullable<typeof d> => d !== null && d.value > 0)
  }, [workouts, sportMeasure, sportAgg])

  // ── Trends ───────────────────────────────────────────────────────────────
  const series = useMemo(() => {
    const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date))
    const marks = yearMarks(sorted.map(w => w.date))
    return sorted
      .map((w, i) => ({
        date: w.date,
        dateLabel: dayLabel(w.date, marks[i]),
        dateFull: fullDate(w.date),
        pace: w.avgPace || null,
        hr: w.avgHR,
        maxHr: w.maxHR || null,
        distance: w.distance,
        duration: w.duration,
        elevation: w.elevationGain,
        calories: w.calories,
        speed: w.avgSpeed || null,
        steps: w.steps || null,
        name: w.name,
        type: w.type,
      }))
  }, [workouts])

  const seriesWithMA = useMemo(() => {
    const window = 3
    const rows = series.map((d, i) => {
      const slice = series.slice(Math.max(0, i - window + 1), i + 1)
      const result: DatedRow = { ...d }
      for (const m of METRICS) {
        const vals = slice.map(s => s[m.id]).filter(v => v !== null) as number[]
        result[`${m.id}_ma`] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      }
      return result
    })
    // Gaps are filled *after* the moving average, so the average stays "the
    // last three activities" rather than becoming "the last three days" the
    // moment the toggle is flipped. The toggle is about the x axis, not the
    // maths on it.
    return withSlots(showGaps ? withEmptyDays(rows) : rows)
  }, [series, showGaps])

  const summaryStats = useMemo(() => {
    if (series.length === 0) return []
    return METRICS.filter(m => selectedMetrics.includes(m.id)).map(m => {
      const vals = series.map(d => d[m.id]).filter(v => v !== null) as number[]
      if (vals.length === 0) return null
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      const trend = vals.length > 3 ? ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100 : 0
      return { ...m, avg, min: Math.min(...vals), max: Math.max(...vals), trend }
    }).filter(Boolean) as (typeof METRICS[number] & { avg: number; min: number; max: number; trend: number })[]
  }, [series, selectedMetrics])

  // Bars per bucket with a moving average over them. Both are the same measure
  // on one axis — a second scale for the trend line would only invite misreading.
  const volume = useMemo(() => {
    const buckets = new Map<string, number>()
    for (const w of workouts) {
      const key = volumeBucket === 'month' ? w.date.slice(0, 7) : weekKey(w.date)
      buckets.set(key, (buckets.get(key) ?? 0) + (volumeMeasure === 'distance' ? w.distance / 1000 : w.duration / 3600))
    }
    let keys = [...buckets.keys()].sort()
    if (keys.length === 0) return []
    if (showGaps) {
      const [first, last] = [keys[0], keys[keys.length - 1]]
      keys = volumeBucket === 'month' ? everyMonthBetween(first, last) : everyWeekBetween(first, last)
    }
    // The rolling average runs over `keys`, so with gaps shown a week off pulls
    // it down the way it actually did, and with them hidden it behaves exactly
    // as it did before the toggle existed.
    const marks = yearMarks(keys)
    return keys.map((key, i) => {
      const win = keys.slice(Math.max(0, i - 3), i + 1)
      return {
        label: volumeBucket === 'month' ? monthLabel(key) : dayLabel(key, marks[i]),
        full: volumeBucket === 'month' ? monthLabel(key) : `Week of ${fullDate(key)}`,
        key,
        value: Math.round((buckets.get(key) ?? 0) * 10) / 10,
        avg: Math.round((win.reduce((a, k) => a + (buckets.get(k) ?? 0), 0) / win.length) * 10) / 10,
      }
    })
  }, [workouts, volumeBucket, volumeMeasure, showGaps])

  // ── Efficiency ───────────────────────────────────────────────────────────
  const hrPaceData = useMemo(() =>
    workouts.filter(w => w.avgPace > 0 && w.avgHR > 0).map(w => ({
      hr: w.avgHR,
      pace: Math.round(w.avgPace),
      distKm: Math.round(w.distance / 100) / 10,
      type: w.type,
      name: w.name,
      date: w.date,
    })),
  [workouts])

  const distPaceData = useMemo(() =>
    workouts.filter(w => w.avgPace > 0 && w.distance > 0).map(w => ({
      km: Math.round(w.distance / 100) / 10,
      pace: Math.round(w.avgPace),
      // Marker area encodes elevation gain, so the slow-because-hilly efforts
      // separate visually from the slow-because-tired ones.
      elev: Math.round(w.elevationGain),
      hr: w.avgHR,
      type: w.type,
      name: w.name,
      date: w.date,
    })),
  [workouts])

  const efficiency = useMemo(() => {
    const usable = series.filter(d => d.hr > 0 && (d.speed ?? 0) > 0 && d.pace)
    if (usable.length === 0) return { rows: [], refHr: 0 }
    // The reference HR is this selection's median, so the adjusted pace lands
    // in the same range as the real paces and needs no configuration.
    const hrs = usable.map(d => d.hr).sort((a, b) => a - b)
    const refHr = hrs[Math.floor(hrs.length / 2)]
    const rows: DatedRow[] = usable.map(d => ({
      date: d.date,
      dateLabel: d.dateLabel,
      dateFull: d.dateFull,
      name: d.name,
      hrPerSpeed: Math.round((d.hr / (d.speed as number)) * 10) / 10,
      adjPace: Math.round((d.pace as number) * (refHr / d.hr)),
      pace: d.pace as number,
      hr: d.hr,
      speed: d.speed as number,
    }))
    return { refHr, rows: withSlots(showGaps ? withEmptyDays(rows) : rows) }
  }, [series, showGaps])

  // ── Load ─────────────────────────────────────────────────────────────────
  const { trainingLoad, acwr } = useMemo(() => {
    const days = Math.min(rangeDays > 0 ? rangeDays : 365, 365)
    // The chronic average needs four weeks of lead-in that sit before the
    // window starts, so daily loads come from the unranged (but type-filtered)
    // library rather than the visible selection.
    const typed = typeFilter === 'All' ? allWorkouts : allWorkouts.filter(w => w.type === typeFilter)
    const byDate = new Map<string, number>()
    for (const w of typed) byDate.set(w.date, (byDate.get(w.date) ?? 0) + loadOf(w))

    const span = days + 27
    const daily: number[] = []
    const keys: string[] = []
    for (let i = span - 1; i >= 0; i--) {
      const dt = new Date()
      dt.setDate(dt.getDate() - i)
      daily.push(byDate.get(toDateKey(dt)) ?? 0)
      keys.push(toDateKey(dt))
    }
    // Prefix sums make each window average O(1) instead of re-summing 28 days.
    const prefix = [0]
    for (const v of daily) prefix.push(prefix[prefix.length - 1] + v)
    const meanEndingAt = (end: number, count: number) => (prefix[end + 1] - prefix[end + 1 - count]) / count

    // Labels are derived after the fact, so the year rule can look at the span
    // the chart will actually draw rather than at the 28-day lead-in too.
    const marks = yearMarks(keys.slice(span - days))
    const trainingLoad: { date: string; full: string; tss: number }[] = []
    const acwr: { date: string; full: string; acute: number; chronic: number; ratio: number | null }[] = []
    for (let end = span - days; end < span; end++) {
      trainingLoad.push({ date: dayLabel(keys[end], marks[end - (span - days)]), full: fullDate(keys[end]), tss: daily[end] })
      const acute = meanEndingAt(end, 7)
      const chronic = meanEndingAt(end, 28)
      acwr.push({
        date: dayLabel(keys[end], marks[end - (span - days)]),
        full: fullDate(keys[end]),
        acute: Math.round(acute),
        chronic: Math.round(chronic),
        ratio: chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null,
      })
    }
    return { trainingLoad, acwr }
  }, [allWorkouts, typeFilter, rangeDays])

  const latestRatio = [...acwr].reverse().find(d => d.ratio != null)?.ratio ?? null

  function toggleMetric(m: Metric) {
    setSelectedMetrics(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m])
  }
  function formatValue(metric: Metric, value: number): string {
    const m = METRICS.find(x => x.id === metric)!
    return m.format ? m.format(value) : value.toFixed(0)
  }

  const scope = `${rangeLabel(rangeDays)}${typeFilter === 'All' ? '' : ` · ${typeFilter.toLowerCase()}`}`

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <h1 className="page-header-title">Analysis</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {workouts.length} activities · {scope}
          </span>
        </div>
        {/* One filter row governs every tab below it. */}
        <div className="analysis-filters">
          <TypeDropdown value={typeFilter} onChange={setTypeFilter} />
          <RangeDropdown value={rangeDays} onChange={setRangeDays} />
          <button
            type="button"
            className={`filter-pill${showGaps ? ' on' : ''}`}
            aria-pressed={showGaps}
            onClick={() => setShowGaps(!showGaps)}
            title="Give every skipped day, week or month its place on the x axis. Charts normally give each activity one position, which closes up the days you did not train — dense and easy to read, but a fortnight off looks like business as usual. Moving averages over activities are unaffected; the rolling average on Training Volume does count the empty buckets, because a week off genuinely lowers it."
          >
            <CalendarRange size={14} />
            <span>Gaps</span>
          </button>
        </div>
      </div>

      <div className="page-content">
        <div style={{ marginBottom: 20 }}>
          <TabStrip items={TABS} value={tab} onChange={setTab} ariaLabel="Analysis sections" />
        </div>

        {/* ── Records: what your best efforts look like ── */}
        {tab === 'records' && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <Award size={16} color="var(--success)" />
              <h3 className="card-title">Personal Records</h3>
              <InfoTip text={`Your best single activity in each category, within the ${scope}. Widen the time range to see all-time bests — these follow the page filter, so a 30-day window shows your best month, not your best ever.`} label="Personal Records" />
            </div>
            {/* The gap to the chart below belongs to the section, not to the
                grid — it used to sit on the grid alone, so the empty state,
                which replaces the grid rather than filling it, ran straight
                into the next card. Every other empty state on this page is
                inside a ChartCard, which is why this was the only one.
                16 is what separates one card from the next everywhere else
                here; the 24 this inherited was the odd one out. */}
            <div style={{ marginBottom: 16 }}>
              {Object.keys(PRs).length === 0 ? (
                <div className="card"><EmptyPlot height={120}>No activities in the {rangeLabel(rangeDays)}</EmptyPlot></div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                  {(Object.entries(PRs) as [WorkoutType, PR][]).map(([type, pr]) => (
                    <div key={type} className="card" style={{ borderTop: `3px solid ${TYPE_COLOR[type]}` }}>
                      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: TYPE_COLOR[type] }}>{type}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* A distance or a climb of zero is not a record, it is
                            the absence of one. Strength cards read "Longest
                            0.0 km" and "Most Elevation 0 m" — two rows of
                            nothing, on the card meant to show your best. */}
                        {pr.longest.distance > 0 && (
                          <PRRow label="Longest" value={`${(pr.longest.distance / 1000).toFixed(1)} km`} on={pr.longest.date} />
                        )}
                        <PRRow label="Longest time" value={fmtDuration(pr.longestTime.duration)} on={pr.longestTime.date} />
                        {pr.fastest && <PRRow label="Best Pace" value={`${fmtPace(pr.fastest.avgPace)} /km`} on={pr.fastest.date} best />}
                        {pr.highest.elevationGain > 0 && (
                          <PRRow label="Most Elevation" value={`${Math.round(pr.highest.elevationGain)} m`} on={pr.highest.date} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <ChartCard
              title="By Sport"
              icon={<Zap size={14} color="var(--accent)" />}
              description={sportAgg === 'best'
                ? 'The single biggest activity of each sport.'
                : 'Everything of each sport, added up.'}
              info="Both halves of the same question: Total is where the period actually went, and Best is the one activity that stands out — the record cards above give the same thing per sport with pace included. Only measures that mean the same thing in every sport are offered; a pace or a heart rate does not, which is why they are on the cards rather than in this comparison. Calories reported by an imported file are used as-is and the rest are estimated, so read those across sports as approximate."
              actions={
                <>
                  <Dropdown
                    value={sportMeasure}
                    options={SPORT_MEASURES.map(m => ({ value: m.id, label: m.label }))}
                    onChange={setSportMeasure}
                    ariaLabel="Measure"
                  />
                  <Segmented
                    value={sportAgg}
                    onChange={setSportAgg}
                    options={[{ id: 'total', label: 'Total' }, { id: 'best', label: 'Best' }]}
                  />
                </>
              }
            >
              {bySport.length === 0 ? (
                <EmptyPlot height={220}>No activities in the {rangeLabel(rangeDays)}</EmptyPlot>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={bySport} margin={space.margin(18, 4)}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="type" tick={{ ...AXIS_TICK, fontSize: 11 }} axisLine={false} tickLine={false} label={xLabel('Activity type')} />
                    <YAxis
                      tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto"
                      tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${Math.round(v * 10) / 10}`}
                      label={space.yLabel(SPORT_MEASURES.find(m => m.id === sportMeasure)!.axis)}
                    />
                    <Tooltip
                      cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        const m = SPORT_MEASURES.find(x => x.id === sportMeasure)!
                        return (
                          <div className="custom-tooltip">
                            <div style={{ fontWeight: 600 }}>{d.type}</div>
                            <div>{m.fmt(d.value)} {sportAgg === 'best' ? 'best single' : 'in total'}</div>
                            <div style={{ color: 'var(--text-3)' }}>{d.count} {d.count === 1 ? 'activity' : 'activities'}</div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                      {bySport.map(d => <Cell key={d.type} fill={d.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </>
        )}

        {/* ── Trends: how the numbers move over time ── */}
        {tab === 'trends' && (
          <>
            <MetricChips selected={selectedMetrics} onToggle={toggleMetric} />

            {summaryStats.length > 0 && (
              <div className="trend-stats">
                {summaryStats.map(s => (
                  <div key={s.id} className="card trend-stat" style={{ borderLeftColor: s.color }}>
                    <div className="trend-stat-label">{s.label}</div>
                    <div className="trend-stat-value" style={{ color: s.color }}>
                      {formatValue(s.id, s.avg)} <span className="trend-stat-unit">{s.unit}</span>
                    </div>
                    {/* A grid, not a flex row: pace is the one metric whose
                        values are "12:05" wide, and three of those in a nowrap
                        row overflowed the card and shunted the trend out of
                        line with every other tile. */}
                    <div className="trend-stat-range">
                      <span>↓ {formatValue(s.id, s.min)}</span>
                      <span>↑ {formatValue(s.id, s.max)}</span>
                      <span style={{ color: s.trend > 0 ? 'var(--success)' : s.trend < 0 ? 'var(--danger)' : 'var(--text-3)' }}>
                        {s.trend > 0 ? '▲' : s.trend < 0 ? '▼' : '—'} {Math.abs(s.trend).toFixed(1)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <ChartCard
              title="Performance Over Time"
              icon={<TrendingUp size={14} color="var(--primary)" />}
              description={`One point per activity, with a dashed 3-activity moving average. ${series.length} activities.${
                showGaps && gapsTooWide(series) ? ' Evenly spaced: the range is too long to give every day its own position.' : ''}`}
              info="Faint lines are individual activities; bold lines smooth them over three activities to show direction rather than noise. All selected metrics share one axis, so use it to read each line's shape and trend, not to compare their absolute heights. Filtering to a single sport makes pace and speed directly comparable. Starting the axis at zero keeps the proportions honest; fitting it to the data is the only way to see movement in a metric like heart rate, which never goes near zero."
              style={{ marginBottom: 16 }}
              actions={
                <Segmented
                  value={trendYAxis}
                  onChange={setTrendYAxis}
                  options={[{ id: 'fit', label: 'Fit' }, { id: 'zero', label: 'Zero' }]}
                />
              }
            >
              {series.length === 0 ? (
                <EmptyPlot height={300}>No activities in the {scope}</EmptyPlot>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={seriesWithMA} margin={space.margin(18)}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="axisKey" ticks={dayTicks(seriesWithMA)} tickFormatter={slotLabel} {...denseXAxis()} label={xLabel('Activity date')} />
                    <YAxis
                      tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto"
                      domain={trendYAxis === 'zero' ? [0, 'auto'] : ['auto', 'auto']}
                      label={space.yLabel('Selected metrics')}
                    />
                    <Tooltip
                      {...KEEP_EMPTY_ROWS}
                      content={({ active, payload, label }) => {
                        if (!active) return null
                        // With gaps shown most positions are days with nothing
                        // on them, and every metric on such a row is null.
                        // KEEP_EMPTY_ROWS is what lets that reach here at all;
                        // without it Recharts hides the tooltip and only the
                        // cursor line moves. The day still names itself and
                        // says it was a rest day.
                        const row = payload?.[0]?.payload as DatedRow | undefined
                        if (!payload?.length || row?.empty) {
                          return (
                            <div className="custom-tooltip">
                              <div style={{ color: 'var(--text-2)', fontWeight: 600 }}>{row?.dateFull ?? slotLabel(label)}</div>
                              <div style={{ color: 'var(--text-3)' }}>No activity</div>
                            </div>
                          )
                        }
                        return (
                          <div className="custom-tooltip">
                            <div style={{ color: 'var(--text-2)', marginBottom: 6, fontWeight: 600 }}>{row?.dateFull ?? slotLabel(label)}</div>
                            {payload.filter(p => !String(p.dataKey).endsWith('_ma')).map(p => {
                              const m = METRICS.find(x => x.id === p.dataKey)
                              if (!m || !selectedMetrics.includes(m.id)) return null
                              return (
                                <div key={p.dataKey as string} style={{ color: m.color, marginBottom: 2 }}>
                                  {m.label}: {p.value !== null ? formatValue(m.id, p.value as number) : '—'} {m.unit}
                                </div>
                              )
                            })}
                          </div>
                        )
                      }}
                    />
                    {selectedMetrics.map(metricId => {
                      const m = METRICS.find(x => x.id === metricId)!
                      return [
                        <Line key={metricId} type="monotone" dataKey={metricId} stroke={m.color} {...DATA_LINE} dot={{ r: 3, fill: m.color, strokeWidth: 0 }} connectNulls isAnimationActive={false} />,
                        <Line key={`${metricId}_ma`} type="monotone" dataKey={`${metricId}_ma`} stroke={m.color} {...TREND_LINE} connectNulls isAnimationActive={false} />,
                      ]
                    })}
                  </LineChart>
                </ResponsiveContainer>
              )}
            </ChartCard>

            <ChartCard
              title="Training Volume"
              icon={<Activity size={14} color="var(--primary)" />}
              description="Total volume per bucket, with a 4-bucket moving average over the bars."
              info="Bars are the raw total for each week or month; the line averages the last four buckets so a single big weekend doesn't read as a trend. Both use the same unit and axis — steady growth in the line is what progressive overload looks like, while a sharp spike is where injuries usually start."
              actions={
                <>
                  <Segmented value={volumeMeasure} onChange={setVolumeMeasure} options={[{ id: 'distance', label: 'Distance' }, { id: 'time', label: 'Time' }]} />
                  <Segmented value={volumeBucket} onChange={setVolumeBucket} options={[{ id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]} />
                </>
              }
            >
              {volume.length === 0 ? (
                <EmptyPlot height={220}>No activities in the {scope}</EmptyPlot>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={volume} margin={space.margin(18, 4)}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="label" {...denseXAxis(9, { bars: true })} label={xLabel(volumeBucket === 'week' ? 'Week starting' : 'Month')} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" label={space.yLabel(volumeMeasure === 'distance' ? 'Distance (km)' : 'Time (hours)')} />
                    <Tooltip
                      cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        const unit = volumeMeasure === 'distance' ? 'km' : 'h'
                        return (
                          <div className="custom-tooltip">
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.full}</div>
                            <div style={{ color: 'var(--primary)' }}>{d.value} {unit}</div>
                            <div style={{ color: 'var(--text-3)' }}>4-bucket avg {d.avg} {unit}</div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="value" fill="var(--primary)" opacity={0.35} radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                    <Line type="monotone" dataKey="avg" stroke="var(--primary)" {...TREND_LINE} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </>
        )}

        {/* ── Efficiency: what speed costs you in heartbeats ── */}
        {tab === 'efficiency' && (
          <>
            <div className="grid-2" style={{ marginBottom: 16 }}>
              <ChartCard
                title="Efficiency Factor"
                icon={<Gauge size={14} color="var(--danger)" />}
                description="Heartbeats spent per km/h of speed. Falling is improving."
                info="Average heart rate divided by average speed for each activity. Because it normalises effort against output, it stays comparable across easy and hard days — unlike raw pace. A downward trend over weeks means your aerobic engine is getting stronger. Heat, altitude, fatigue and hills all push it up temporarily, so read the slope over a month rather than any single point."
              >
                {efficiency.rows.length === 0 ? (
                  <EmptyPlot height={220}>Needs activities with both heart rate and speed</EmptyPlot>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={efficiency.rows} margin={space.margin(18, 4)}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="axisKey" ticks={dayTicks(efficiency.rows)} tickFormatter={slotLabel} {...denseXAxis(9)} label={xLabel('Activity date')} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" domain={['dataMin - 1', 'dataMax + 1']} label={space.yLabel('bpm/kph')} />
                      <Tooltip
                        {...KEEP_EMPTY_ROWS}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          if (!d?.name) {
                            return (
                              <div className="custom-tooltip">
                                <div style={{ fontWeight: 600 }}>{d?.dateFull ?? ''}</div>
                                <div style={{ color: 'var(--text-3)' }}>No activity</div>
                              </div>
                            )
                          }
                          return (
                            <div className="custom-tooltip">
                              <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                              <div style={{ color: 'var(--text-3)' }}>{d.dateFull}</div>
                              <div style={{ color: SERIES_COLORS[1] }}>{d.hrPerSpeed} bpm/kph</div>
                              <div style={{ color: 'var(--text-3)' }}>{d.hr} bpm · {d.speed.toFixed(1)} km/h</div>
                            </div>
                          )
                        }}
                      />
                      {/* An explicit fill: Recharts defaults a dot to solid
                          white, which is invisible in light mode and wrong in
                          both. Every other line on this page names its own. */}
                      <Line type="monotone" dataKey="hrPerSpeed" stroke={SERIES_COLORS[1]} strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: SERIES_COLORS[1] }} connectNulls isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>

              <ChartCard
                title="Pace at Fixed HR"
                icon={<Gauge size={14} color="var(--blue)" />}
                description={`Every pace rescaled to ${efficiency.refHr || '—'} bpm, so easy and hard days compare directly.`}
                info={`Each activity's pace is multiplied by the ratio of the reference heart rate to its own, answering "what would this pace have been at ${efficiency.refHr || 'a typical'} bpm?". The reference is the median heart rate of the current selection, so it recalibrates as you change the filters and needs no setup. A downward trend means you're covering ground faster at the same effort.`}
              >
                {efficiency.rows.length === 0 ? (
                  <EmptyPlot height={220}>Needs activities with both heart rate and pace</EmptyPlot>
                ) : (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={efficiency.rows} margin={space.margin(18, 4)}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="axisKey" ticks={dayTicks(efficiency.rows)} tickFormatter={slotLabel} {...denseXAxis(9)} label={xLabel('Activity date')} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" reversed domain={['dataMin - 15', 'dataMax + 15']} tickFormatter={v => fmtPace(v)} label={space.yLabel('Adjusted pace (min/km)')} />
                      <Tooltip
                        {...KEEP_EMPTY_ROWS}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          if (!d?.name) {
                            return (
                              <div className="custom-tooltip">
                                <div style={{ fontWeight: 600 }}>{d?.dateFull ?? ''}</div>
                                <div style={{ color: 'var(--text-3)' }}>No activity</div>
                              </div>
                            )
                          }
                          return (
                            <div className="custom-tooltip">
                              <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                              <div style={{ color: 'var(--text-3)' }}>{d.dateFull}</div>
                              <div style={{ color: 'var(--blue)' }}>{fmtPace(d.adjPace)} /km adjusted</div>
                              <div style={{ color: 'var(--text-3)' }}>{fmtPace(d.pace)} /km actual · {d.hr} bpm</div>
                            </div>
                          )
                        }}
                      />
                      <Line type="monotone" dataKey="adjPace" stroke="var(--blue)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--blue)' }} connectNulls isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ChartCard>
            </div>

            <div className="grid-2">
              <ChartCard
                title="HR vs Pace"
                icon={<Target size={14} color="var(--primary)" />}
                description="Lower HR at faster pace = improved aerobic efficiency. Marker size is distance, colour is activity type."
                info="Every activity plotted by its average pace and average heart rate, with marker area scaled to distance. As fitness improves the cloud drifts down and to the right — faster for fewer beats. Points high and left are hard efforts or bad days; large markers sitting low are your strongest long runs."
              >
                {hrPaceData.length === 0 ? (
                  <EmptyPlot height={240}>No activities with pace and heart rate in the {rangeLabel(rangeDays)}</EmptyPlot>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <ScatterChart margin={space.margin(18)}>
                      <CartesianGrid {...GRID_PROPS} vertical />
                      {/* Units live in the axis labels rather than on every tick:
                          with " bpm" appended to each value the labels grew wide
                          enough to be clipped by the plot area. */}
                      <XAxis type="number" dataKey="pace" name="Pace" domain={['dataMin - 20', 'dataMax + 20']} padding={END_PADDING} tick={AXIS_TICK} axisLine={false} tickLine={false} reversed tickFormatter={v => fmtPace(v)} label={xLabel('Pace (min/km) — faster →')} />
                      <YAxis type="number" dataKey="hr" name="HR" domain={['dataMin - 5', 'dataMax + 5']} padding={EDGE_PADDING_Y} width="auto" tick={AXIS_TICK} axisLine={false} tickLine={false} label={space.yLabel('Avg HR (bpm)')} />
                      <ZAxis type="number" dataKey="distKm" range={[40, 220]} name="Distance" />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-strong)' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div className="custom-tooltip">
                              <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                              <div style={{ color: 'var(--text-3)' }}>{d.type} · {d.date}</div>
                              <div>Pace: {fmtPace(d.pace)} /km</div>
                              <div>HR: {d.hr} bpm</div>
                              <div>Distance: {d.distKm} km</div>
                            </div>
                          )
                        }}
                      />
                      {/* Coloured per point rather than one series per type: a
                          <Scatter> per type would give each its own z order and
                          tooltip, when all that is wanted is the sport's hue. */}
                      <Scatter data={hrPaceData} opacity={0.6} shape={<ScatterDot />} activeShape={<ActiveScatterDot />}>
                        {hrPaceData.map((d, i) => <Cell key={i} fill={TYPE_COLOR[d.type]} />)}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                )}
                <TypeLegend types={hrPaceData.map(d => d.type)} />
              </ChartCard>

              <ChartCard
                title="Distance vs Pace"
                icon={<Navigation size={14} color="var(--blue)" />}
                description="Does pace hold up as distance grows? Marker size is elevation gain, colour is activity type."
                info="Each activity plotted by distance against pace, with marker area scaled to elevation gain. A flat cloud means your pace is durable over distance; one that slopes toward slower paces as distance grows points at endurance rather than speed being the limiter. Large markers low on the chart are hills, not fatigue — that's what the size encoding is there to separate."
              >
                {distPaceData.length === 0 ? (
                  <EmptyPlot height={240}>No activities with distance and pace in the {rangeLabel(rangeDays)}</EmptyPlot>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <ScatterChart margin={space.margin(18)}>
                      <CartesianGrid {...GRID_PROPS} vertical />
                      <XAxis type="number" dataKey="km" name="Distance" domain={['dataMin - 1', 'dataMax + 1']} padding={END_PADDING} tick={AXIS_TICK} axisLine={false} tickLine={false} label={xLabel('Distance (km)')} />
                      <YAxis type="number" dataKey="pace" name="Pace" domain={['dataMin - 20', 'dataMax + 20']} padding={EDGE_PADDING_Y} width="auto" tick={AXIS_TICK} axisLine={false} tickLine={false} reversed tickFormatter={v => fmtPace(v)} label={space.yLabel('Pace (min/km)')} />
                      {/* Elevation can legitimately be 0, so the range starts at
                          a visible minimum rather than collapsing to a dot. */}
                      <ZAxis type="number" dataKey="elev" range={[40, 220]} name="Elevation" />
                      <Tooltip
                        cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-strong)' }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div className="custom-tooltip">
                              <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                              <div style={{ color: 'var(--text-3)' }}>{d.type} · {d.date}</div>
                              <div>Distance: {d.km} km</div>
                              <div>Pace: {fmtPace(d.pace)} /km</div>
                              <div>Elevation: {d.elev} m</div>
                              <div>HR: {d.hr || '—'} bpm</div>
                            </div>
                          )
                        }}
                      />
                      <Scatter data={distPaceData} opacity={0.6} shape={<ScatterDot />} activeShape={<ActiveScatterDot />}>
                        {distPaceData.map((d, i) => <Cell key={i} fill={TYPE_COLOR[d.type]} />)}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                )}
                <TypeLegend types={distPaceData.map(d => d.type)} />
              </ChartCard>
            </div>
          </>
        )}

        {/* ── Load: how hard you're pushing, and whether it's sustainable ── */}
        {tab === 'load' && (
          <>
            <ChartCard
              title="Daily Training Load"
              icon={<Flame size={14} color="var(--blue)" />}
              description="A TSS-equivalent score per day, from duration and heart-rate effort."
              info="Each day's score is the sum of its activities, where one hour at 150 bpm scores about 100. It rewards both duration and intensity, so a short hard session and a long easy one can land in the same place. Gaps are rest days — they matter as much as the bars."
              style={{ marginBottom: 16 }}
            >
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trainingLoad} margin={space.margin(18, 4)}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...denseXAxis(9)} label={xLabel('Date')} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" label={space.yLabel('Load (TSS-equivalent)')} />
                  <Tooltip
                    cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return <div className="custom-tooltip"><div>{d.full}</div><div style={{ color: 'var(--blue)' }}>Load {d.tss}</div></div>
                    }}
                  />
                  <Bar dataKey="tss" fill="var(--blue)" radius={[2, 2, 0, 0]} opacity={0.8} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard
              title="Acute : Chronic Workload"
              icon={<Activity size={14} color="var(--purple)" />}
              description="Last 7 days of load against the last 28. The shaded band (0.8–1.3) is the sweet spot."
              info="Divides your average daily load over the past week by the same average over the past four weeks. Around 1.0 means this week matches what your body is already used to. Below 0.8 you're detraining or tapering; above 1.5 (the dashed line) is the range most associated with injury, because you're loading faster than tissue adapts. The four weeks of history behind each point come from your full library, so this stays correct even on a short time range."
              actions={latestRatio != null && (
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
                  color: latestRatio > 1.5 ? 'var(--danger)' : latestRatio < 0.8 ? 'var(--text-3)' : 'var(--success)',
                }}>
                  {latestRatio.toFixed(2)} today
                </span>
              )}
            >
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={acwr} margin={space.margin(18, 4)}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="date" {...denseXAxis(9)} label={xLabel('Date')} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" domain={[0, (max: number) => Math.max(2, Math.ceil(max * 10) / 10)]} label={space.yLabel('Acute : chronic ratio')} />
                  <ReferenceArea y1={0.8} y2={1.3} fill="var(--success)" fillOpacity={0.1} />
                  <ReferenceLine y={1.5} stroke="var(--danger)" strokeDasharray="4 4" strokeOpacity={0.6} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div className="custom-tooltip">
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.full}</div>
                          <div style={{ color: 'var(--purple)' }}>Ratio {d.ratio ?? '—'}</div>
                          <div style={{ color: 'var(--text-3)' }}>Acute {d.acute} · Chronic {d.chronic}</div>
                        </div>
                      )
                    }}
                  />
                  <Line type="monotone" dataKey="ratio" stroke="var(--purple)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </>
        )}

        {/* ── Weather: does temperature move your pace or heart rate? ── */}
        {tab === 'weather' && (
          <div className="chart-stack">
          <ChartCard
            title={`Temperature vs ${weatherMetric === 'pace' ? 'Pace' : 'Heart Rate'}`}
            icon={<CloudSun size={14} color="var(--primary)" />}
            description={weatherGroups.length > 1
              ? `One line per sport, in ${binWidth} °C bands — a run and a ride are never averaged together, because their pace means different things.`
              : `Grouped into ${binWidth} °C bands.`}
            info="Each point on the line is the average across every workout in that temperature band, with the individual workouts shown faintly behind it. The band width adapts to the range of temperatures you actually train in, so a mild climate is still resolved finely. Bands with fewer than three workouts are left out — one workout is not an average, though it stays visible as a dot. This is observational: distance, terrain, sleep and training phase all move with the seasons too, so treat it as a tendency rather than a cause."
            actions={
              <Segmented
                value={weatherMetric}
                onChange={setWeatherMetric}
                options={[{ id: 'pace', label: 'Pace' }, { id: 'hr', label: 'HR' }]}
              />
            }
          >
            {/* Three distinct empty states, because they have three different
                remedies and one generic "no data" hides all of them. */}
            {prefs?.weatherEnabled === false && !anyWeather ? (
              <EmptyPlot height={260}>
                Weather lookups are turned off, so there is nothing to compare yet.
                Turn them on in Settings → Weather, where you can also fetch
                conditions for workouts you already have.
              </EmptyPlot>
            ) : !anyWeather ? (
              <EmptyPlot height={260}>
                No weather recorded yet. New workouts get it automatically; to
                include the ones you already have, use Settings → Weather.
              </EmptyPlot>
            ) : weatherPool.length === 0 ? (
              <EmptyPlot height={260}>
                No workouts with weather in this period. Widen the range, or
                pick another activity.
              </EmptyPlot>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart margin={space.margin(18)}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis
                      type="number" dataKey="temp" name="Temperature"
                      domain={['dataMin - 2', 'dataMax + 2']}
                      padding={END_PADDING}
                      tick={AXIS_TICK} axisLine={false} tickLine={false}
                      label={xLabel('Temperature (°C)')}
                    />
                    <YAxis
                      type="number" dataKey="value"
                      padding={EDGE_PADDING_Y}
                      tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto"
                      tickFormatter={v => weatherMetric === 'pace' ? fmtPace(v) : String(Math.round(v))}
                      label={space.yLabel(weatherMetric === 'pace' ? 'Pace (/km)' : 'Avg HR (bpm)')}
                    />
                    <Tooltip
                      /* Item-based, not axis-based. A ComposedChart's shared
                         tooltip resolves by x position across every series at
                         once, and with a scatter that means a tap answers only
                         where some series happens to have a value — which is
                         why four sports' dots were unreachable and the fifth
                         worked. shared=false asks the mark under the pointer. */
                      shared={false}
                      cursor={{ stroke: HOVER_FILL }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = realPoint(payload) as any
                        if (!d) return null
                        const value = weatherMetric === 'pace' ? fmtPace(d.value ?? d[weatherMetric]) : Math.round(d.value ?? d[weatherMetric])
                        return (
                          <div className="custom-tooltip">
                            <div>{d.name ?? `${d.from}–${d.to} °C`}</div>
                            {/* Which sport, in its own colour: with several
                                lines on one chart the number alone does not
                                say whose it is. */}
                            {d.type && <div style={{ color: TYPE_COLOR[d.type as WorkoutType] }}>{d.type}</div>}
                            <div style={{ color: 'var(--primary)' }}>{value}{weatherMetric === 'hr' ? ' bpm' : ''}</div>
                            {d.count != null && <div style={{ color: 'var(--text-3)' }}>{d.count} workouts</div>}
                          </div>
                        )
                      }}
                    />
                    {/* The individual workouts, faint and in their sport's
                        colour. The line alone would read as a law; the spread
                        behind it is the honest part. */}
                    {/* One series, coloured per point — see the explore chart
                        below for why five of them could not all be tapped. */}
                    <Scatter data={weatherDots} dataKey="value" opacity={0.55} isAnimationActive={false} shape={<ScatterDot />} activeShape={<ActiveScatterDot />}>
                      {weatherDots.map((d, i) => <Cell key={i} fill={TYPE_COLOR[d.type as WorkoutType]} />)}
                    </Scatter>
                    {/* One line per sport, and only once that sport has both
                        bands to draw and enough workouts behind them to mean
                        anything. Below that its dots are the whole story, which
                        is the honest picture of a handful of workouts — a line
                        through two bands is a straight segment asserting a
                        trend that nothing supports. */}
                    {weatherGroups.map(g => g.bins.length > 0 && g.count >= MIN_CORRELATION_POINTS && (
                      <Line
                        key={`line-${g.type}`}
                        data={g.bins}
                        type="monotone" dataKey="value"
                        stroke={g.color} {...TREND_LINE}
                        dot={{ r: 3, fill: g.color }}
                        isAnimationActive={false}
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
                {/* One sport: the sentence. Several: a line each, because
                    five paragraphs saying the same thing about different
                    sports is not five times as useful. */}
                {weatherGroups.length === 1 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 10, lineHeight: 1.55 }}>
                    {describeCorrelation(weatherGroups[0].r, weatherMetric)}
                    {' '}
                    <span style={{ color: 'var(--text-3)' }}>
                      ({weatherGroups[0].count} workout{weatherGroups[0].count === 1 ? '' : 's'}
                      {weatherGroups[0].r !== null && `, r = ${weatherGroups[0].r.toFixed(2)}`})
                    </span>
                  </p>
                ) : (
                  <div className="wx-legend">
                    {weatherGroups.map(g => (
                      <span key={g.type} className="wx-legend-item">
                        <span className="wx-legend-dot" style={{ background: g.color }} aria-hidden />
                        {g.type}
                        <span className="wx-legend-num">
                          {g.count}{g.r !== null && ` · r ${g.r.toFixed(2)}`}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </ChartCard>

          {/* ── Weather: anything against anything ── */}
          <ChartCard
            title={`${exploreField.label} vs ${exploreMetric.label}`}
            icon={<Sparkles size={14} color="var(--primary)" />}
            description={exploreGroups.length > 1
              ? 'Every workout in this period, one dot each, coloured by sport — and a fitted line for each, never one through all of them.'
              : 'Every workout in this period, one dot each.'}
            info="Pick any weather value and any figure from your workouts and see whether they move together. Unbinned on purpose: with this many combinations most temperature bands would hold a single workout, and a line drawn through those would state far more than the data does. The fitted line is least squares over the dots, and r is how tightly they follow it — a value near 0 means no relationship in this data, not that there is none. Everything here is observational, and the seasons move distance, terrain and training phase along with the weather."
            actions={
              <div className="explore-picks">
                <Dropdown
                  value={exploreX}
                  onChange={setExploreX}
                  ariaLabel="Weather value"
                  options={WEATHER_FIELDS.map(f => ({ value: f.key, label: f.label }))}
                />
                <span className="explore-vs">vs</span>
                <Dropdown
                  value={exploreY}
                  onChange={setExploreY}
                  ariaLabel="Workout figure"
                  options={PERF_METRICS.map(m => ({ value: m.key, label: m.label }))}
                />
              </div>
            }
          >
            {explorePoints.length === 0 ? (
              <EmptyPlot height={260}>
                No workouts in this period record both
                {' '}{exploreField.label.toLowerCase()} and {exploreMetric.label.toLowerCase()}.
                Widen the range, or pick another pair.
              </EmptyPlot>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart margin={space.margin(18)}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis
                      type="number" dataKey="x" name={exploreField.label}
                      domain={['dataMin', 'dataMax']}
                      padding={END_PADDING}
                      tick={AXIS_TICK} axisLine={false} tickLine={false}
                      label={xLabel(`${exploreField.label} (${exploreField.unit})`)}
                    />
                    <YAxis
                      type="number" dataKey="y"
                      padding={EDGE_PADDING_Y}
                      tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={exploreMetric.format}
                      label={space.yLabel(`${exploreMetric.label} (${exploreMetric.unit})`)}
                    />
                    <Tooltip
                      /* Item-based, not axis-based. A ComposedChart's shared
                         tooltip resolves by x position across every series at
                         once, and with a scatter that means a tap answers only
                         where some series happens to have a value — which is
                         why four sports' dots were unreachable and the fifth
                         worked. shared=false asks the mark under the pointer. */
                      shared={false}
                      cursor={{ stroke: HOVER_FILL }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        // The fitted line carries no workout. Skipping past it
                        // rather than giving up on the whole payload is what
                        // lets a dot under a fit still answer.
                        const d = realPoint(payload) as any
                        if (!d?.name) return null
                        return (
                          <div className="custom-tooltip">
                            <div>{d.name}</div>
                            <div style={{ color: 'var(--text-3)' }}>{d.date}</div>
                            <div style={{ color: 'var(--primary)' }}>
                              {exploreMetric.format(d.y)} {exploreMetric.unit}
                              {' · '}
                              {exploreField.label.toLowerCase()} {d.x.toFixed(exploreField.digits)} {exploreField.unit}
                            </div>
                          </div>
                        )
                      }}
                    />
                    {/* One Scatter with a Cell per point, not one Scatter per
                        sport. Recharts gives each series its own tooltip, so
                        with five of them only one sport's dots ever answered a
                        tap and which one was down to z order — the same trap
                        the two Efficiency scatters avoid by doing this. */}
                    <Scatter data={explorePoints} dataKey="y" opacity={0.6} isAnimationActive={false} shape={<ScatterDot />} activeShape={<ActiveScatterDot />}>
                      {explorePoints.map((d, i) => <Cell key={i} fill={TYPE_COLOR[d.type as WorkoutType]} />)}
                    </Scatter>
                    {/* A fit each. One line through every sport at once would
                        be a trend in the mix of sports, not in the weather. */}
                    {/* Only where r survived the floor: linearFit will happily
                        draw a slope through two points, and r is the thing that
                        says whether that slope is worth asserting. */}
                    {exploreGroups.map(g => g.fit && g.r !== null && (
                      <Line
                        key={`fit-${g.type}`}
                        data={g.fit} dataKey="y" type="linear"
                        stroke={g.color} {...TREND_LINE} legendType="none"
                      />
                    ))}
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="wx-legend">
                  {exploreGroups.map(g => (
                    <span key={g.type} className="wx-legend-item">
                      <span className="wx-legend-dot" style={{ background: g.color }} aria-hidden />
                      {g.type}
                      <span className="wx-legend-num">
                        {g.points.length}{g.r !== null && ` · r ${g.r.toFixed(2)}`}
                      </span>
                    </span>
                  ))}
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.55 }}>
                  {exploreGroups.every(g => g.r === null)
                    ? 'Not enough spread to fit a line — every workout sits at much the same value.'
                    : 'This is a correlation, not a cause.'}
                </p>
              </>
            )}
          </ChartCard>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * One line of a records card: what the record is, the figure, and when.
 *
 * The date is not decoration — a personal best with no "when" is half a fact,
 * and on a page whose time range the reader controls it is the half that says
 * whether they are looking at a lifetime or at last month.
 *
 * `best` marks the standout figure, in --success rather than the accent: this
 * is an achievement, and on the Rose accent an accent-coloured record read as
 * an error.
 */
function PRRow({ label, value, on, best }: { label: string; value: string; on?: string; best?: boolean }) {
  return (
    <div className="pr-row">
      <span className="pr-row-label">{label}</span>
      <span className="pr-row-figure">
        <span className={`pr-row-value${best ? ' best' : ''}`}>{value}</span>
        {on && <span className="pr-row-date">{shortDate(new Date(`${on}T00:00:00`))}</span>}
      </span>
    </div>
  )
}
