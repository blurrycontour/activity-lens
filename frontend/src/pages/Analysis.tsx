import { useMemo } from 'react'
import { TYPE_COLOR, fmtPace, type WorkoutType, type Workout } from '../data/workouts'
import { useWorkouts } from '../context/WorkoutsContext'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import ChartCard, { EmptyPlot } from '../components/ChartCard'
import TabStrip from '../components/TabStrip'
import InfoTip from '../components/InfoTip'
import { denseXAxis, useChartSpace } from '../components/ChartAxis'
import TypeLegend from '../components/TypeLegend'
import { useLocalStorage } from '../lib/useLocalStorage'
import { filterByRange, rangeLabel, toDateKey } from '../lib/range'
import { AXIS_TICK, GRID_PROPS, HOVER_FILL } from '../lib/chartColors'
import {
  binByTemperature, binWidthFor, describeCorrelation, hasUsableWeather, temperatureCorrelation,
  type WeatherMetric,
} from '../lib/weather'
import { usePreferences } from '../context/PreferencesContext'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell, LineChart, Line, ComposedChart, ReferenceArea, ReferenceLine,
} from 'recharts'
import { Award, Target, Zap, Activity, Navigation, TrendingUp, Gauge, Flame, CloudSun } from 'lucide-react'

type PR = { longest: Workout; fastest: Workout | null; highest: Workout }

type TabId = 'records' | 'trends' | 'efficiency' | 'load' | 'weather'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'records', label: 'Records', icon: <Award size={15} /> },
  { id: 'trends', label: 'Trends', icon: <TrendingUp size={15} /> },
  { id: 'efficiency', label: 'Efficiency', icon: <Gauge size={15} /> },
  { id: 'load', label: 'Load', icon: <Flame size={15} /> },
  { id: 'weather', label: 'Weather', icon: <CloudSun size={15} /> },
]

type Metric = 'pace' | 'hr' | 'maxHr' | 'distance' | 'duration' | 'elevation' | 'calories' | 'speed' | 'steps'

const METRICS: { id: Metric; label: string; color: string; unit: string; format?: (v: number) => string }[] = [
  { id: 'pace', label: 'Avg Pace', color: 'var(--primary)', unit: '/km', format: fmtPace },
  { id: 'hr', label: 'Avg HR', color: 'var(--danger)', unit: 'bpm' },
  { id: 'maxHr', label: 'Max HR', color: '#f97316', unit: 'bpm' },
  { id: 'distance', label: 'Distance', color: 'var(--blue)', unit: 'km', format: v => (v / 1000).toFixed(1) },
  { id: 'duration', label: 'Duration', color: 'var(--purple)', unit: 'min', format: v => Math.round(v / 60).toString() },
  { id: 'elevation', label: 'Elevation Gain', color: 'var(--hike)', unit: 'm' },
  { id: 'calories', label: 'Calories', color: 'var(--accent)', unit: 'kcal' },
  { id: 'speed', label: 'Avg Speed', color: 'var(--swim)', unit: 'km/h', format: v => v.toFixed(1) },
  { id: 'steps', label: 'Steps', color: 'var(--strength)', unit: '', format: v => Math.round(v).toLocaleString() },
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

/** Axis label placed below the plot, clear of the tick row. */
function xLabel(value: string) {
  return { value, position: 'insideBottom' as const, offset: -12, fontSize: 10, fill: 'var(--text-3)' }
}

/** Rotated axis label centred on the y axis. */
function yLabel(value: string) {
  return {
    value, angle: -90, position: 'insideLeft' as const,
    fontSize: 10, fill: 'var(--text-3)', style: { textAnchor: 'middle' as const },
  }
}

/** Two-option segmented control used by the volume chart's toggles. */
function Segmented<T extends string>({ value, onChange, options }: {
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string }[]
}) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          style={{
            padding: '4px 10px', fontSize: 11, cursor: 'pointer', border: 'none',
            background: value === o.id ? 'var(--primary-dim)' : 'var(--bg-3)',
            color: value === o.id ? 'var(--primary)' : 'var(--text-3)',
            fontWeight: value === o.id ? 600 : 400,
          }}
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
  const [weatherMetric, setWeatherMetric] = useLocalStorage<WeatherMetric>('al_an_wx_metric', 'pace')
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
  // Restricted to one activity type, and that is not a nicety: a Run and a Ride
  // report pace in the same units and mean nothing like the same thing, so a
  // mixed chart plots the ratio of rides to runs at each temperature rather
  // than anything about temperature. When the page filter is 'All' this falls
  // back to Run, which is what most libraries have most of.
  const weatherType: WorkoutType = typeFilter === 'All' ? 'Run' : typeFilter
  const weatherPool = useMemo(
    () => inRange.filter(w => w.type === weatherType && hasUsableWeather(w, weatherMetric)),
    [inRange, weatherType, weatherMetric],
  )
  // Band width follows the spread actually present: a mild climate that never
  // leaves 18–28 °C would get two bands at a fixed 5 °C, which is not a chart.
  const binWidth = useMemo(
    () => binWidthFor(weatherPool, weatherMetric),
    [weatherPool, weatherMetric],
  )
  const tempBins = useMemo(
    () => binByTemperature(weatherPool, weatherMetric, binWidth),
    [weatherPool, weatherMetric, binWidth],
  )
  const tempScatter = useMemo(
    () => weatherPool.map(w => ({
      temp: w.weather!.tempC,
      value: weatherMetric === 'pace' ? w.avgPace : w.avgHR,
      name: w.name,
    })),
    [weatherPool, weatherMetric],
  )
  const tempR = useMemo(
    () => temperatureCorrelation(weatherPool, weatherMetric),
    [weatherPool, weatherMetric],
  )
  // Anything at all, regardless of the current filters — the difference between
  // "no weather yet" and "none in this window" is the whole empty state.
  const anyWeather = useMemo(() => allWorkouts.some(w => w.weather), [allWorkouts])

  // ── Records ──────────────────────────────────────────────────────────────
  const { PRs, calByType } = useMemo(() => {
    const PRs: Partial<Record<WorkoutType, PR>> = {}
    for (const type of ['Run', 'Ride', 'Hike', 'Swim', 'Strength'] as WorkoutType[]) {
      const tw = workouts.filter(w => w.type === type)
      if (tw.length === 0) continue
      const paced = tw.filter(w => w.avgPace)
      PRs[type] = {
        longest: tw.reduce((a, b) => a.distance > b.distance ? a : b),
        fastest: paced.length > 0 ? paced.reduce((a, b) => a.avgPace < b.avgPace ? a : b) : null,
        highest: tw.reduce((a, b) => a.elevationGain > b.elevationGain ? a : b),
      }
    }
    // One bar per type, coloured via Cell. A separate <Bar> per type would
    // create one series each and leave every bar offset in its own slot
    // rather than centred on its category.
    const calByType = (['Run', 'Ride', 'Hike', 'Swim', 'Strength'] as WorkoutType[]).map(t => ({
      type: t,
      total: Math.round(workouts.filter(w => w.type === t).reduce((a, w) => a + w.calories, 0)),
      count: workouts.filter(w => w.type === t).length,
      fill: TYPE_COLOR[t],
    })).filter(d => d.count > 0)
    return { PRs, calByType }
  }, [workouts])

  // ── Trends ───────────────────────────────────────────────────────────────
  const series = useMemo(() =>
    [...workouts]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(w => ({
        date: w.date,
        dateLabel: new Date(`${w.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
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
      })),
  [workouts])

  const seriesWithMA = useMemo(() => {
    const window = 3
    return series.map((d, i) => {
      const slice = series.slice(Math.max(0, i - window + 1), i + 1)
      const result: Record<string, number | null | string> = { ...d }
      for (const m of METRICS) {
        const vals = slice.map(s => s[m.id]).filter(v => v !== null) as number[]
        result[`${m.id}_ma`] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      }
      return result
    })
  }, [series])

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
    const rows = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return rows.map(([key, value], i) => {
      const win = rows.slice(Math.max(0, i - 3), i + 1)
      return {
        label: volumeBucket === 'month' ? monthLabel(key) : key.slice(5),
        key,
        value: Math.round(value * 10) / 10,
        avg: Math.round((win.reduce((a, [, v]) => a + v, 0) / win.length) * 10) / 10,
      }
    })
  }, [workouts, volumeBucket, volumeMeasure])

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
    return {
      refHr,
      rows: usable.map(d => ({
        dateLabel: d.dateLabel,
        name: d.name,
        hrPerSpeed: Math.round((d.hr / (d.speed as number)) * 10) / 10,
        adjPace: Math.round((d.pace as number) * (refHr / d.hr)),
        pace: d.pace as number,
        hr: d.hr,
        speed: d.speed as number,
      })),
    }
  }, [series])

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
    const labels: string[] = []
    for (let i = span - 1; i >= 0; i--) {
      const dt = new Date()
      dt.setDate(dt.getDate() - i)
      daily.push(byDate.get(toDateKey(dt)) ?? 0)
      labels.push(dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    }
    // Prefix sums make each window average O(1) instead of re-summing 28 days.
    const prefix = [0]
    for (const v of daily) prefix.push(prefix[prefix.length - 1] + v)
    const meanEndingAt = (end: number, count: number) => (prefix[end + 1] - prefix[end + 1 - count]) / count

    const trainingLoad: { date: string; tss: number }[] = []
    const acwr: { date: string; acute: number; chronic: number; ratio: number | null }[] = []
    for (let end = span - days; end < span; end++) {
      trainingLoad.push({ date: labels[end], tss: daily[end] })
      const acute = meanEndingAt(end, 7)
      const chronic = meanEndingAt(end, 28)
      acwr.push({
        date: labels[end],
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
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Analysis</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {workouts.length} activities · {scope}
          </span>
        </div>
        {/* One filter row governs every tab below it. */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <TypeDropdown value={typeFilter} onChange={setTypeFilter} />
          <RangeDropdown value={rangeDays} onChange={setRangeDays} />
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
              <Award size={16} color="var(--primary)" />
              <h3 style={{ fontSize: 14, fontWeight: 600 }}>Personal Records</h3>
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
                        <PRRow label="Longest" value={`${(pr.longest.distance / 1000).toFixed(1)} km`} />
                        {pr.fastest && <PRRow label="Best Pace" value={`${fmtPace(pr.fastest.avgPace)} /km`} accent />}
                        <PRRow label="Most Elevation" value={`${Math.round(pr.highest.elevationGain)} m`} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <ChartCard
              title="Total Calories by Type"
              icon={<Zap size={14} color="var(--accent)" />}
              description="Where your energy went across the selected period."
              info="Sums the calories of every activity of each type. Values reported by an imported file are used as-is; the rest are estimated from your body metrics and the calorie method set in Settings, so treat cross-sport comparisons as approximate."
            >
              {calByType.length === 0 ? (
                <EmptyPlot height={220}>No activities in the {rangeLabel(rangeDays)}</EmptyPlot>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={calByType} margin={space.margin(18, 4)}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="type" tick={{ ...AXIS_TICK, fontSize: 11 }} axisLine={false} tickLine={false} label={xLabel('Activity type')} />
                    <YAxis
                      tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto"
                      tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`}
                      label={yLabel('Calories (kcal)')}
                    />
                    <Tooltip
                      cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div className="custom-tooltip">
                            <div style={{ fontWeight: 600 }}>{d.type}</div>
                            <div>{d.total.toLocaleString()} kcal · {d.count} activities</div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={72} isAnimationActive={false}>
                      {calByType.map(d => <Cell key={d.type} fill={d.fill} />)}
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
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
              {METRICS.map(m => (
                <button
                  key={m.id}
                  onClick={() => toggleMetric(m.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 12px', borderRadius: 99,
                    border: `1px solid ${selectedMetrics.includes(m.id) ? m.color : 'var(--border)'}`,
                    background: selectedMetrics.includes(m.id) ? `${m.color}18` : 'transparent',
                    color: selectedMetrics.includes(m.id) ? m.color : 'var(--text-3)',
                    fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.color, opacity: selectedMetrics.includes(m.id) ? 1 : 0.3 }} />
                  {m.label}
                </button>
              ))}
            </div>

            {summaryStats.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>
                {summaryStats.map(s => (
                  <div key={s.id} className="card" style={{ borderLeft: `3px solid ${s.color}` }}>
                    <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: s.color, letterSpacing: '-0.03em' }}>
                      {formatValue(s.id, s.avg)} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-3)' }}>{s.unit}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                      <span>↓ {formatValue(s.id, s.min)}</span>
                      <span>↑ {formatValue(s.id, s.max)}</span>
                      <span style={{ color: s.trend > 0 ? 'var(--success)' : s.trend < 0 ? 'var(--danger)' : 'var(--text-3)', marginLeft: 'auto' }}>
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
              description={`One point per activity, with a bolder 3-activity moving average. ${series.length} activities.`}
              info="Faint lines are individual activities; bold lines smooth them over three activities to show direction rather than noise. All selected metrics share one axis, so use it to read each line's shape and trend, not to compare their absolute heights. Filtering to a single sport makes pace and speed directly comparable."
              style={{ marginBottom: 16 }}
            >
              {series.length === 0 ? (
                <EmptyPlot height={300}>No activities in the {scope}</EmptyPlot>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={seriesWithMA} margin={space.margin(18)}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis dataKey="dateLabel" {...denseXAxis()} label={xLabel('Activity date')} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" label={yLabel('Selected metrics')} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        return (
                          <div className="custom-tooltip">
                            <div style={{ color: 'var(--text-2)', marginBottom: 6, fontWeight: 600 }}>{label}</div>
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
                        <Line key={metricId} type="monotone" dataKey={metricId} stroke={m.color} strokeWidth={1.5} dot={{ r: 3, fill: m.color, strokeWidth: 0 }} connectNulls opacity={0.4} isAnimationActive={false} />,
                        <Line key={`${metricId}_ma`} type="monotone" dataKey={`${metricId}_ma`} stroke={m.color} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />,
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
                    <XAxis dataKey="label" {...denseXAxis(9)} label={xLabel(volumeBucket === 'week' ? 'Week starting' : 'Month')} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" label={yLabel(volumeMeasure === 'distance' ? 'Distance (km)' : 'Time (hours)')} />
                    <Tooltip
                      cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        const unit = volumeMeasure === 'distance' ? 'km' : 'h'
                        return (
                          <div className="custom-tooltip">
                            <div style={{ fontWeight: 600, marginBottom: 2 }}>{volumeBucket === 'week' ? `Week of ${d.key}` : d.label}</div>
                            <div style={{ color: 'var(--primary)' }}>{d.value} {unit}</div>
                            <div style={{ color: 'var(--text-3)' }}>4-bucket avg {d.avg} {unit}</div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="value" fill="var(--primary)" opacity={0.35} radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                    <Line type="monotone" dataKey="avg" stroke="var(--primary)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
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
                      <XAxis dataKey="dateLabel" {...denseXAxis(9)} label={xLabel('Activity date')} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" domain={['dataMin - 1', 'dataMax + 1']} label={yLabel('bpm per km/h')} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div className="custom-tooltip">
                              <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                              <div style={{ color: 'var(--text-3)' }}>{d.dateLabel}</div>
                              <div style={{ color: 'var(--danger)' }}>{d.hrPerSpeed} bpm per km/h</div>
                              <div style={{ color: 'var(--text-3)' }}>{d.hr} bpm · {d.speed.toFixed(1)} km/h</div>
                            </div>
                          )
                        }}
                      />
                      <Line type="monotone" dataKey="hrPerSpeed" stroke="var(--danger)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0 }} isAnimationActive={false} />
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
                      <XAxis dataKey="dateLabel" {...denseXAxis(9)} label={xLabel('Activity date')} />
                      <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" reversed domain={['dataMin - 15', 'dataMax + 15']} tickFormatter={v => fmtPace(v)} label={yLabel('Adjusted pace (min/km)')} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div className="custom-tooltip">
                              <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                              <div style={{ color: 'var(--text-3)' }}>{d.dateLabel}</div>
                              <div style={{ color: 'var(--blue)' }}>{fmtPace(d.adjPace)} /km adjusted</div>
                              <div style={{ color: 'var(--text-3)' }}>{fmtPace(d.pace)} /km actual · {d.hr} bpm</div>
                            </div>
                          )
                        }}
                      />
                      <Line type="monotone" dataKey="adjPace" stroke="var(--blue)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0 }} isAnimationActive={false} />
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
                      <XAxis type="number" dataKey="pace" name="Pace" domain={['dataMin - 20', 'dataMax + 20']} tick={AXIS_TICK} axisLine={false} tickLine={false} reversed tickFormatter={v => fmtPace(v)} label={xLabel('Pace (min/km) — faster →')} />
                      <YAxis type="number" dataKey="hr" name="HR" domain={['dataMin - 5', 'dataMax + 5']} width="auto" tick={AXIS_TICK} axisLine={false} tickLine={false} label={yLabel('Avg HR (bpm)')} />
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
                      <Scatter data={hrPaceData} opacity={0.6}>
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
                      <XAxis type="number" dataKey="km" name="Distance" domain={['dataMin - 1', 'dataMax + 1']} tick={AXIS_TICK} axisLine={false} tickLine={false} label={xLabel('Distance (km)')} />
                      <YAxis type="number" dataKey="pace" name="Pace" domain={['dataMin - 20', 'dataMax + 20']} width="auto" tick={AXIS_TICK} axisLine={false} tickLine={false} reversed tickFormatter={v => fmtPace(v)} label={yLabel('Pace (min/km)')} />
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
                      <Scatter data={distPaceData} opacity={0.6}>
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
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" label={yLabel('Load (TSS-equivalent)')} />
                  <Tooltip
                    cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return <div className="custom-tooltip"><div>{d.date}</div><div style={{ color: 'var(--blue)' }}>Load {d.tss}</div></div>
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
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" domain={[0, (max: number) => Math.max(2, Math.ceil(max * 10) / 10)]} label={yLabel('Acute : chronic ratio')} />
                  <ReferenceArea y1={0.8} y2={1.3} fill="var(--success)" fillOpacity={0.1} />
                  <ReferenceLine y={1.5} stroke="var(--danger)" strokeDasharray="4 4" strokeOpacity={0.6} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div className="custom-tooltip">
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.date}</div>
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
          <ChartCard
            title={`Temperature vs ${weatherMetric === 'pace' ? 'Pace' : 'Heart Rate'}`}
            icon={<CloudSun size={14} color="var(--primary)" />}
            description={`${weatherType} workouts, grouped into ${binWidth} °C bands.`}
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
                No {weatherType.toLowerCase()} workouts with weather in this period.
                Widen the range, or pick another activity.
              </EmptyPlot>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart margin={space.margin(18)}>
                    <CartesianGrid {...GRID_PROPS} />
                    <XAxis
                      type="number" dataKey="temp" name="Temperature"
                      domain={['dataMin - 2', 'dataMax + 2']}
                      tick={AXIS_TICK} axisLine={false} tickLine={false}
                      label={xLabel('Temperature (°C)')}
                    />
                    <YAxis
                      type="number" dataKey="value"
                      tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto"
                      tickFormatter={v => weatherMetric === 'pace' ? fmtPace(v) : String(Math.round(v))}
                      label={yLabel(weatherMetric === 'pace' ? 'Pace (/km)' : 'Avg HR (bpm)')}
                    />
                    <Tooltip
                      cursor={{ stroke: HOVER_FILL }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        const value = weatherMetric === 'pace' ? fmtPace(d.value ?? d[weatherMetric]) : Math.round(d.value ?? d[weatherMetric])
                        return (
                          <div className="custom-tooltip">
                            <div>{d.name ?? `${d.from}–${d.to} °C`}</div>
                            <div style={{ color: 'var(--primary)' }}>{value}{weatherMetric === 'hr' ? ' bpm' : ''}</div>
                            {d.count != null && <div style={{ color: 'var(--text-3)' }}>{d.count} workouts</div>}
                          </div>
                        )
                      }}
                    />
                    {/* The individual workouts, faint. The line alone would read
                        as a law; the spread behind it is the honest part. */}
                    <Scatter data={tempScatter} dataKey="value" fill="var(--text-3)" opacity={0.45} isAnimationActive={false} />
                    {/* Only once there are bands to draw. Below that the dots
                        are the whole chart, which is the honest picture of a
                        handful of workouts — better than no chart at all. */}
                    {tempBins.length > 0 && (
                      <Line
                        data={tempBins.map(b => ({ temp: (b.from + b.to) / 2, value: b[weatherMetric], from: b.from, to: b.to, count: b.count }))}
                        type="monotone" dataKey="value"
                        stroke="var(--primary)" strokeWidth={2}
                        dot={{ r: 3, fill: 'var(--primary)' }}
                        isAnimationActive={false}
                      />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
                <p style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 10, lineHeight: 1.55 }}>
                  {describeCorrelation(tempR, weatherMetric)}
                  {' '}
                  <span style={{ color: 'var(--text-3)' }}>
                    ({weatherPool.length} workout{weatherPool.length === 1 ? '' : 's'}
                    {tempR !== null && `, r = ${tempR.toFixed(2)}`})
                  </span>
                </p>
              </>
            )}
          </ChartCard>
        )}
      </div>
    </div>
  )
}

function PRRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: accent ? 'var(--primary)' : undefined }}>{value}</span>
    </div>
  )
}
