import { useMemo, useState } from 'react'
import { type Workout, type WorkoutType } from '../data/workouts'
import { useWorkouts } from '../context/WorkoutsContext'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import { useLocalStorage } from '../lib/useLocalStorage'
import { filterByRange, rangeLabel, rangeStartDate, toDateKey } from '../lib/range'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell,
} from 'recharts'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Distinct hues for the year series of the year-over-year chart. */
const YEAR_COLORS = ['var(--primary)', 'var(--blue)', 'var(--purple)', 'var(--hike)', 'var(--swim)', '#ec4899']

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

export default function Heatmap() {
  const { workouts } = useWorkouts()
  const [hoveredDay, setHoveredDay] = useState<{ date: string; count: number; duration: number; x: number; y: number } | null>(null)
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'All'>('All')
  const [rangeDays, setRangeDays] = useLocalStorage<number>('al_hm_range', 365)
  const [measure, setMeasure] = useLocalStorage<Measure>('al_hm_measure', 'count')

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
    // Newest years first, capped so the chart stays readable.
    const years = Object.keys(byYear).sort((a, b) => b.localeCompare(a)).slice(0, YEAR_COLORS.length)
    const data = MONTHS.map((label, i) => {
      const row: Record<string, string | number> = { month: label }
      for (const y of years) row[y] = measure === 'duration' ? byYear[y][i] / 3600 : byYear[y][i]
      return row
    })
    return { yoyData: data, yoyYears: years }
  }, [typeWorkouts, m, measure])

  // Monthly / yearly rollups over the selected range.
  const monthlyStats = useMemo(() => rollup(filteredWorkouts, d => d.slice(0, 7)).slice(0, 6), [filteredWorkouts])
  const yearlyStats = useMemo(() => rollup(filteredWorkouts, d => d.slice(0, 4)), [filteredWorkouts])

  function statValue(s: { count: number; duration: number }): number {
    return measure === 'count' ? s.count : s.duration
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Heatmap</h1>
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
        {/* Heatmap grid: cells stretch to fill the available width, so on
            wide screens each day becomes a rectangle rather than a fixed
            11x11 square. */}
        <div className="card" style={{ padding: '20px', overflowX: 'auto' }}>
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
              borderRadius: 8, padding: '10px 14px', zIndex: 100,
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
        <ChartCard title="Day of Week Distribution" subtitle={`by ${m.label.toLowerCase()}`}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dayOfWeek} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} unit={m.axisLabel || undefined} />
              <Tooltip
                cursor={{ fill: 'var(--bg-3)' }}
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
              <Bar dataKey="display" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {dayOfWeek.map(d => <Cell key={d.label} fill="var(--primary)" opacity={d.value > 0 ? 0.85 : 0.25} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Year over year */}
        <ChartCard
          title="Year over Year"
          subtitle={yoyYears.length > 1 ? `monthly ${m.label.toLowerCase()}, all years` : 'needs more than one year of data'}
        >
          {yoyYears.length === 0 ? (
            <div style={{ height: 220, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--text-3)' }}>No activities yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={yoyData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} unit={m.axisLabel || undefined} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="custom-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                        {payload.map(p => (
                          <div key={p.dataKey as string} style={{ color: p.color }}>
                            {p.dataKey as string}: {measure === 'duration' ? `${Number(p.value).toFixed(1)}h` : Math.round(Number(p.value))}
                          </div>
                        ))}
                      </div>
                    )
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {yoyYears.map((y, i) => (
                  <Line
                    key={y} type="monotone" dataKey={y}
                    stroke={YEAR_COLORS[i]} strokeWidth={i === 0 ? 2.5 : 1.5}
                    dot={{ r: 2.5, strokeWidth: 0 }} opacity={i === 0 ? 1 : 0.65}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Monthly breakdown */}
        <BreakdownGrid
          title="Monthly Breakdown"
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
          stats={yearlyStats}
          label={key => key}
          measure={measure}
          statValue={statValue}
          format={m.format}
        />
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

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600 }}>{title}</h3>
        {subtitle && <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{subtitle}</span>}
      </div>
      <div className="card">{children}</div>
    </div>
  )
}

function BreakdownGrid({ title, stats, label, measure, statValue, format }: {
  title: string
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
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{title}</h3>
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
