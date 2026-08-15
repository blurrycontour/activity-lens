import { useMemo, useState } from 'react'
import { type Workout, type WorkoutType } from '../data/workouts'
import { useWorkouts } from '../context/WorkoutsContext'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import { useLocalStorage } from '../lib/useLocalStorage'
import { filterByRange, rangeLabel, rangeStartDate, toDateKey } from '../lib/range'
import { AXIS_TICK, GRID_PROPS, HOVER_FILL, recencyRamp } from '../lib/chartColors'
import { useThemeTokens } from '../lib/useThemeTokens'
import { recentWeekStarts, weekdayMatrix } from '../lib/insights'
import ChartCard, { EmptyPlot } from '../components/ChartCard'
import InfoTip from '../components/InfoTip'
import { useChartSpace } from '../components/ChartAxis'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Legend, Cell,
} from 'recharts'
import { CalendarDays, GitCompareArrows, Sigma } from 'lucide-react'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Years compared side by side before the chart gets too dense to read. */
const MAX_YEARS = 5
/** Weeks compared side by side in the week-over-week chart. */
const WEEKS_COMPARED = 5

type TabId = 'calendar' | 'compare' | 'totals'

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'calendar', label: 'Calendar', icon: <CalendarDays size={15} /> },
  { id: 'compare', label: 'Compare', icon: <GitCompareArrows size={15} /> },
  { id: 'totals', label: 'Totals', icon: <Sigma size={15} /> },
]

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

/** What the heatmap and the distribution charts measure. */
type Measure = 'count' | 'duration'

/** Per-measure formatting, so every chart on the page reads the same way. */
const MEASURES: Record<Measure, { label: string; axisLabel: string; value: (w: Workout) => number; format: (v: number) => string }> = {
  count: {
    label: 'Activities',
    axisLabel: '',
    value: () => 1,
    format: v => `${Math.round(v)}`,
  },
  duration: {
    label: 'Duration',
    axisLabel: 'h',
    // Accumulated in seconds and rendered as hours, which keeps the sums exact.
    value: w => w.duration,
    format: v => v >= 3600 ? `${(v / 3600).toFixed(1)}h` : `${Math.round(v / 60)}m`,
  },
}

export default function Consistency() {
  const { workouts } = useWorkouts()
  const [hoveredDay, setHoveredDay] = useState<{ date: string; count: number; duration: number; x: number; y: number } | null>(null)
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'All'>('All')
  const [rangeDays, setRangeDays] = useLocalStorage<number>('al_hm_range', 365)
  const [measure, setMeasure] = useLocalStorage<Measure>('al_hm_measure', 'count')
  const [tab, setTab] = useLocalStorage<TabId>('al_cs_tab', 'calendar')
  const space = useChartSpace()

  const m = MEASURES[measure]

  const typeWorkouts = useMemo(
    () => typeFilter === 'All' ? workouts : workouts.filter(w => w.type === typeFilter),
    [workouts, typeFilter],
  )
  const filteredWorkouts = useMemo(() => filterByRange(typeWorkouts, rangeDays), [typeWorkouts, rangeDays])

  // Day cells for the calendar grid, laid out one column per week starting on
  // a Sunday. The window follows the selected range; all-time starts at the
  // earliest recorded activity.
  const { grid, months, maxValue } = useMemo(() => {
    const activityMap: Record<string, { count: number; duration: number }> = {}
    for (const w of filteredWorkouts) {
      if (!activityMap[w.date]) activityMap[w.date] = { count: 0, duration: 0 }
      activityMap[w.date].count++
      activityMap[w.date].duration += w.duration
    }

    const endDate = new Date()
    const earliest = filteredWorkouts.reduce<string | null>((a, w) => a == null || w.date < a ? w.date : a, null)
    const startKey = rangeStartDate(rangeDays) ?? earliest ?? toDateKey(endDate)
    const startDate = new Date(`${startKey}T00:00:00`)
    while (startDate.getDay() !== 0) startDate.setDate(startDate.getDate() - 1)

    const weeks: Array<Array<{ date: string; count: number; duration: number } | null>> = []
    const monthLabels: { label: string; col: number }[] = []
    const cursor = new Date(startDate)
    let col = 0
    let lastMonth = -1

    while (cursor <= endDate) {
      const week: Array<{ date: string; count: number; duration: number } | null> = []
      for (let d = 0; d < 7; d++) {
        if (cursor <= endDate) {
          const dateStr = toDateKey(cursor)
          const data = activityMap[dateStr] || { count: 0, duration: 0 }
          const month = cursor.getMonth()
          if (month !== lastMonth && cursor.getDate() <= 7) {
            monthLabels.push({ label: MONTHS[month], col })
            lastMonth = month
          }
          week.push({ date: dateStr, count: data.count, duration: data.duration })
          cursor.setDate(cursor.getDate() + 1)
        } else {
          week.push(null)
        }
      }
      weeks.push(week)
      col++
    }

    const values = Object.values(activityMap).map(v => measure === 'count' ? v.count : v.duration)
    return { grid: weeks, months: monthLabels, maxValue: Math.max(...values, 1) }
  }, [filteredWorkouts, rangeDays, measure])

  function cellValue(day: { count: number; duration: number }): number {
    return measure === 'count' ? day.count : day.duration
  }

  function getColor(value: number): string {
    if (value === 0) return 'var(--bg-3)'
    const intensity = Math.min(value / maxValue, 1)
    if (intensity < 0.25) return 'color-mix(in srgb, var(--primary) 20%, transparent)'
    if (intensity < 0.5) return 'color-mix(in srgb, var(--primary) 45%, transparent)'
    if (intensity < 0.75) return 'color-mix(in srgb, var(--primary) 70%, transparent)'
    return 'var(--primary)'
  }

  // Day-of-week totals across the selected range.
  const dayOfWeek = useMemo(() => {
    const totals = DAYS.map(label => ({ label, value: 0 }))
    for (const w of filteredWorkouts) {
      totals[new Date(`${w.date}T00:00:00`).getDay()].value += m.value(w)
    }
    return totals.map(d => ({ ...d, display: measure === 'duration' ? d.value / 3600 : d.value }))
  }, [filteredWorkouts, m, measure])

  // Year over year: month-by-month totals per calendar year. Deliberately
  // computed from the whole library rather than the selected range, since
  // comparing years is only meaningful with every year present.
  const { yoyData, yoyYears } = useMemo(() => {
    const byYear: Record<string, number[]> = {}
    for (const w of typeWorkouts) {
      const year = w.date.slice(0, 4)
      if (!byYear[year]) byYear[year] = Array(12).fill(0)
      byYear[year][Number(w.date.slice(5, 7)) - 1] += m.value(w)
    }
    // Newest years first, capped so the grouped bars stay readable.
    const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a)).slice(0, MAX_YEARS)
    const data = MONTHS.map((label, i) => {
      const row: Record<string, string | number> = { month: label }
      for (const y of years) row[y] = measure === 'duration' ? byYear[y][i] / 3600 : byYear[y][i]
      return row
    })
    return { yoyData: data, yoyYears: years }
  }, [typeWorkouts, m, measure])

  // Cumulative distance per calendar year, sampled at each month end so the
  // curves line up regardless of how many activities each year holds.
  const { cumulativeData, cumulativeYears } = useMemo(() => {
    const byYear: Record<string, number[]> = {}
    for (const w of typeWorkouts) {
      const year = w.date.slice(0, 4)
      if (!byYear[year]) byYear[year] = Array(12).fill(0)
      byYear[year][Number(w.date.slice(5, 7)) - 1] += w.distance / 1000
    }
    const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a)).slice(0, MAX_YEARS)
    const thisYear = String(new Date().getFullYear())
    const thisMonth = new Date().getMonth()
    const data = MONTHS.map((label, i) => {
      const row: Record<string, string | number | null> = { month: label }
      for (const y of years) {
        // Don't draw the current year past today — a flat tail to December
        // would read as a plateau rather than "not run yet".
        row[y] = y === thisYear && i > thisMonth
          ? null
          : Math.round(byYear[y].slice(0, i + 1).reduce((a, b) => a + b, 0))
      }
      return row
    })
    return { cumulativeData: data, cumulativeYears: years }
  }, [typeWorkouts])

  // Week over week, built exactly like the year-over-year chart: the x axis is
  // a position within the cycle (weekday rather than month) and each series is
  // one cycle. Like that chart it reads from the whole type-filtered library,
  // since a fixed set of recent weeks is what makes them comparable.
  const { wowData, wowWeeks } = useMemo(() => {
    const weeks = recentWeekStarts(WEEKS_COMPARED)
    const raw = weekdayMatrix(typeWorkouts, weeks, m.value)
    const data = measure === 'duration'
      ? raw.map(row => {
          const out: Record<string, string | number> = { day: row.day }
          for (const w of weeks) out[w] = Math.round((row[w] as number) / 360) / 10
          return out
        })
      : raw
    // Newest week first so the recency ramp puts the strongest colour on it.
    return { wowData: data, wowWeeks: [...weeks].reverse() }
  }, [typeWorkouts, m, measure])

  // Monthly / yearly rollups over the selected range.
  const monthlyStats = useMemo(() => rollup(filteredWorkouts, d => d.slice(0, 7)).slice(0, 6), [filteredWorkouts])
  const yearlyStats = useMemo(() => rollup(filteredWorkouts, d => d.slice(0, 4)), [filteredWorkouts])

  // Resolved fresh each render rather than memoised, so switching the accent
  // in Settings is reflected the next time this page draws — and subscribed to
  // the theme, so "the next time" is now rather than whenever something else
  // happens to cause a render. See useThemeTokens.
  useThemeTokens()
  const yearRamp = recencyRamp(yoyYears.length)
  const cumulativeRamp = recencyRamp(cumulativeYears.length)
  const weekRamp = recencyRamp(wowWeeks.length)

  function statValue(s: { count: number; duration: number }): number {
    return measure === 'count' ? s.count : s.duration
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <h1 className="page-header-title">Consistency</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {filteredWorkouts.length} activities · {rangeLabel(rangeDays)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <TypeDropdown value={typeFilter} onChange={setTypeFilter} />
          <RangeDropdown value={rangeDays} onChange={setRangeDays} />
          <MeasureToggle value={measure} onChange={setMeasure} />
        </div>
      </div>

      <div className="page-content">
        <nav className="tab-strip" style={{ marginBottom: 20 }} aria-label="Consistency sections">
          {TABS.map(t => (
            <button
              key={t.id}
              className={`tab-strip-item${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>

        {tab === 'calendar' && (<>
        {/* Heatmap grid: cells stretch to fill the available width, so on
            wide screens each day becomes a rectangle rather than a fixed
            11x11 square. */}
        <div className="card" style={{ padding: '20px', overflowX: 'auto' }}>
          <div className="chart-card-head">
            <h3 className="chart-card-title">Activity Calendar</h3>
            <InfoTip
              label="Activity Calendar"
              text={`One cell per day, columns running Sunday to Saturday, shaded by ${measure === 'count' ? 'how many activities' : 'how much time'} you logged. Shading is relative to your busiest day in the current selection, so the scale rebases when you change the filters. Unbroken runs of colour are streaks; the blank stretches are where consistency slipped.`}
            />
          </div>
          <p className="chart-card-desc">Daily activity across the {rangeLabel(rangeDays)}, shaded by {m.label.toLowerCase()}.</p>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Day labels */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 16, flexShrink: 0 }}>
              {DAYS.map(d => (
                <div key={d} style={{
                  height: 14, lineHeight: '14px',
                  fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)',
                  width: 20, textAlign: 'right',
                }}>
                  {d}
                </div>
              ))}
            </div>

            <div style={{ flex: 1, minWidth: grid.length * 12 }}>
              {/* Month labels */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${grid.length}, 1fr)`, height: 14, marginBottom: 2 }}>
                {months.map((mo, i) => (
                  <div
                    key={i}
                    style={{
                      gridColumnStart: mo.col + 1,
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-3)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {mo.label}
                  </div>
                ))}
              </div>

              {/* Weeks */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${grid.length}, 1fr)`, gap: 2 }}>
                {grid.map((week, wi) => (
                  <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {week.map((day, di) => (
                      <div
                        key={di}
                        style={{
                          width: '100%', height: 14, borderRadius: 2,
                          background: day ? getColor(cellValue(day)) : 'transparent',
                          border: day && day.count > 0 ? `1px solid rgba(255,255,255,0.1)` : 'none',
                          cursor: day && day.count > 0 ? 'pointer' : 'default',
                          transition: 'transform 0.1s',
                          position: 'relative',
                        }}
                        onMouseEnter={event => day && day.count > 0 && setHoveredDay({ ...day, x: event.clientX, y: event.clientY })}
                        onMouseLeave={() => setHoveredDay(null)}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, justifyContent: 'flex-end' }}>
            <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Less</span>
            {[0, 0.25, 0.5, 0.75, 1].map(v => (
              <div key={v} style={{ width: 14, height: 14, borderRadius: 2, background: getColor(v === 0 ? 0 : Math.ceil(v * maxValue)) }} />
            ))}
            <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>More</span>
          </div>

          {hoveredDay && (
            <div style={{
              position: 'fixed',
              top: hoveredDay.y + 12, left: hoveredDay.x + 12,
              background: 'var(--bg-2)', border: '1px solid var(--border-strong)',
              // A cursor-following tooltip, so it shares the tooltip layer
              // rather than sitting on a number of its own.
              borderRadius: 8, padding: '10px 14px', zIndex: 'var(--z-tooltip)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>{hoveredDay.date}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
                {hoveredDay.count} {hoveredDay.count === 1 ? 'activity' : 'activities'} · {Math.round(hoveredDay.duration / 60)} min
              </div>
            </div>
          )}
        </div>

        {/* Day of week distribution — sits directly under the calendar since
            it answers the same "when do I train" question. */}
        <ChartCard
          title="Day of Week Distribution"
          description={`Which days you actually train, by ${m.label.toLowerCase()}.`}
          info="Totals every activity in the selected range onto the weekday it happened. Tall weekend bars with a hollow midweek is the classic pattern for people who run out of time on workdays — useful for spotting whether your plan matches your week rather than your intentions."
          style={{ marginTop: 16 }}
        >
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dayOfWeek} margin={space.margin(18, 4)}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="label" tick={{ ...AXIS_TICK, fontSize: 11 }} axisLine={false} tickLine={false} label={xLabel('Day of week')} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" unit={m.axisLabel || undefined} label={yLabel(measure === 'count' ? 'Activities' : 'Duration (hours)')} />
              <Tooltip
                cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="custom-tooltip">
                      <div style={{ fontWeight: 600, marginBottom: 2 }}>{label}</div>
                      <div>{m.format(payload[0].payload.value)}{measure === 'count' ? ' activities' : ''}</div>
                    </div>
                  )
                }}
              />
              <Bar dataKey="display" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
                {dayOfWeek.map(d => <Cell key={d.label} fill="var(--primary)" opacity={d.value > 0 ? 0.85 : 0.25} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
        </>)}

        {tab === 'compare' && (<>
        {/* Year over year */}
        <ChartCard
          title="Year over Year"
          description={yoyYears.length > 1
            ? `Each month side by side across your last ${yoyYears.length} years, by ${m.label.toLowerCase()}.`
            : 'Compares months across years — needs more than one year of data to be interesting.'}
          info="Groups every month's total by calendar year so you can see whether this March beat last March. Bars run newest to oldest within each month and are shaded from your accent colour down to grey, so the strongest bar is always the most recent year. This chart deliberately ignores the page's time range — comparing years needs every year present."
          style={{ marginTop: 16 }}
        >
          {yoyYears.length === 0 ? (
            <EmptyPlot height={260}>No activities yet</EmptyPlot>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              {/* Years are an ordered series, so they get a single-hue ramp
                  stepping away from the accent rather than arbitrary hues —
                  that stays legible whichever accent the user has picked. */}
              <BarChart data={yoyData} margin={space.margin(18)} barCategoryGap="18%" barGap={2}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} label={xLabel('Month')} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" unit={m.axisLabel || undefined} label={yLabel(measure === 'count' ? 'Activities' : 'Duration (hours)')} />
                <Tooltip
                  cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="custom-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                        {payload.map(p => (
                          <div key={p.dataKey as string} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                            {p.dataKey as string}: {measure === 'duration' ? `${Number(p.value).toFixed(1)}h` : Math.round(Number(p.value))}
                          </div>
                        ))}
                      </div>
                    )
                  }}
                />
                <Legend verticalAlign="top" align="right" height={26} wrapperStyle={{ fontSize: 11, paddingBottom: 6 }} />
                {yoyYears.map((y, i) => (
                  <Bar key={y} dataKey={y} fill={yearRamp[i]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard
          title="Week over Week"
          description={`Each weekday across your last ${WEEKS_COMPARED} weeks, by ${m.label.toLowerCase()}.`}
          info={`The weekly counterpart of the chart above: the x axis is a position inside the cycle — Monday to Sunday instead of January to December — and each bar is one of the last ${WEEKS_COMPARED} weeks, newest in the strongest colour. Read down a weekday to see whether that slot is a habit or an accident, and across the chart to see whether your training days are drifting. Empty weekdays are genuine rest days, not missing data.`}
          style={{ marginTop: 16 }}
        >
          {wowWeeks.length === 0 ? (
            <EmptyPlot height={260}>No activities yet</EmptyPlot>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={wowData} margin={space.margin(18)} barCategoryGap="18%" barGap={2}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="day" tick={AXIS_TICK} axisLine={false} tickLine={false} label={xLabel('Day of week')} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" label={yLabel(measure === 'count' ? 'Activities' : 'Duration (hours)')} />
                <Tooltip
                  cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    const active_ = payload.filter(p => Number(p.value) > 0)
                    return (
                      <div className="custom-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                        {active_.length === 0
                          ? <div style={{ color: 'var(--text-3)' }}>Rest day in every week shown</div>
                          : active_.map(p => (
                            <div key={p.dataKey as string} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                              week of {String(p.dataKey).slice(5)}: {measure === 'duration' ? `${Number(p.value).toFixed(1)}h` : Math.round(Number(p.value))}
                            </div>
                          ))}
                      </div>
                    )
                  }}
                />
                <Legend
                  verticalAlign="top" align="right" height={26}
                  wrapperStyle={{ fontSize: 11, paddingBottom: 6 }}
                  formatter={value => `w/c ${String(value).slice(5)}`}
                />
                {wowWeeks.map((week, i) => (
                  <Bar key={week} dataKey={week} fill={weekRamp[i]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
        </>)}

        {tab === 'totals' && (<>
        {/* Cumulative distance by year */}
        <ChartCard
          title="Cumulative Distance by Year"
          description="Kilometres banked from January onward, one line per year."
          info="Each line adds up that year's distance month by month, so the steepness is your rate and the height is the total. Because every year starts at zero in January they're directly comparable — if this year's line sits above last year's at the same month, you're ahead of pace. The current year stops at today rather than flattening out to December. Like the chart above, it uses your whole library rather than the page's time range."
          style={{ marginTop: 16 }}
        >
          {cumulativeYears.length === 0 ? (
            <EmptyPlot height={260}>No activities yet</EmptyPlot>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={cumulativeData} margin={space.margin(18)}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="month" tick={AXIS_TICK} axisLine={false} tickLine={false} label={xLabel('Month')} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width="auto" label={yLabel('Cumulative distance (km)')} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="custom-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                        {payload.filter(p => p.value != null).map(p => (
                          <div key={p.dataKey as string} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
                            {p.dataKey as string}: {Math.round(Number(p.value)).toLocaleString()} km
                          </div>
                        ))}
                      </div>
                    )
                  }}
                />
                <Legend verticalAlign="top" align="right" height={26} wrapperStyle={{ fontSize: 11, paddingBottom: 6 }} />
                {cumulativeYears.map((y, i) => (
                  <Line
                    key={y} type="monotone" dataKey={y}
                    stroke={cumulativeRamp[i]} strokeWidth={i === 0 ? 2.5 : 2}
                    dot={false} connectNulls={false} isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Monthly breakdown */}
        <BreakdownGrid
          title="Monthly Breakdown"
          info="The six most recent months inside your selected time range, newest first. The bar under each month is that month relative to your biggest month on screen, and the footer always shows distance and time regardless of which measure the page toggle is set to."
          stats={monthlyStats}
          label={key => {
            const [yr, mo] = key.split('-')
            return `${MONTHS[parseInt(mo) - 1]} ${yr}`
          }}
          measure={measure}
          statValue={statValue}
          format={m.format}
        />

        {/* Yearly breakdown */}
        <BreakdownGrid
          title="Yearly Breakdown"
          info="The same rollup at year granularity, covering whatever years fall inside your selected time range. Set the range to All time to see every year you have recorded."
          stats={yearlyStats}
          label={key => key}
          measure={measure}
          statValue={statValue}
          format={m.format}
        />
        </>)}
      </div>
    </div>
  )
}

type Rollup = [string, { count: number; duration: number; distance: number }]

/** Groups workouts by a key derived from their date, newest bucket first. */
function rollup(workouts: Workout[], keyOf: (date: string) => string): Rollup[] {
  const stats: Record<string, { count: number; duration: number; distance: number }> = {}
  for (const w of workouts) {
    const key = keyOf(w.date)
    if (!stats[key]) stats[key] = { count: 0, duration: 0, distance: 0 }
    stats[key].count++
    stats[key].duration += w.duration
    stats[key].distance += w.distance
  }
  return Object.entries(stats).sort((a, b) => b[0].localeCompare(a[0]))
}

function MeasureToggle({ value, onChange }: { value: Measure; onChange: (v: Measure) => void }) {
  return (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {(['count', 'duration'] as Measure[]).map(id => (
        <button
          key={id}
          onClick={() => onChange(id)}
          style={{
            padding: '6px 12px', fontSize: 12, cursor: 'pointer', border: 'none',
            background: value === id ? 'var(--primary-dim)' : 'var(--bg-3)',
            color: value === id ? 'var(--primary)' : 'var(--text-3)',
            fontWeight: value === id ? 600 : 400,
          }}
        >
          {MEASURES[id].label}
        </button>
      ))}
    </div>
  )
}

function BreakdownGrid({ title, info, stats, label, measure, statValue, format }: {
  title: string
  info: string
  stats: Rollup[]
  label: (key: string) => string
  measure: Measure
  statValue: (s: { count: number; duration: number }) => number
  format: (v: number) => string
}) {
  if (stats.length === 0) return null
  const max = Math.max(...stats.map(([, s]) => statValue(s)), 1)
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
        <h3 className="card-title">{title}</h3>
        <InfoTip text={info} label={title} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
        {stats.map(([key, s]) => (
          <div key={key} className="card" style={{ padding: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{label(key)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--primary)', fontWeight: 700 }}>
                {measure === 'count' ? `${s.count} activities` : format(s.duration)}
              </span>
            </div>
            <div style={{ background: 'var(--bg-3)', borderRadius: 99, height: 4, marginBottom: 8 }}>
              <div style={{ width: `${(statValue(s) / max) * 100}%`, height: '100%', background: 'var(--primary)', borderRadius: 99, transition: 'width 0.4s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{(s.distance / 1000).toFixed(0)} km</span>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
                {Math.round(s.duration / 3600)}h {Math.round((s.duration % 3600) / 60)}m
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
