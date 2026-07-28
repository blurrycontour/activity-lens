import { useState, useMemo } from 'react'
import { fmtPace, type WorkoutType } from '../data/workouts'
import { useWorkouts } from '../context/WorkoutsContext'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import { useLocalStorage } from '../lib/useLocalStorage'
import { filterByRange, rangeLabel } from '../lib/range'
import { AXIS_TICK, GRID_PROPS, HOVER_FILL } from '../lib/chartColors'
import { EdgeTick } from '../components/ChartAxis'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ComposedChart, Bar,
} from 'recharts'

type Metric = 'pace' | 'hr' | 'maxHr' | 'distance' | 'duration' | 'elevation' | 'calories' | 'speed' | 'steps'

const METRICS: { id: Metric; label: string; color: string; unit: string; format?: (v: number) => string }[] = [
  { id: 'pace', label: 'Avg Pace', color: 'var(--primary)', unit: '/km', format: fmtPace },
  { id: 'hr', label: 'Avg HR', color: '#ef4444', unit: 'bpm' },
  { id: 'maxHr', label: 'Max HR', color: '#f97316', unit: 'bpm' },
  { id: 'distance', label: 'Distance', color: 'var(--blue)', unit: 'km', format: v => (v / 1000).toFixed(1) },
  { id: 'duration', label: 'Duration', color: 'var(--purple)', unit: 'min', format: v => Math.round(v / 60).toString() },
  { id: 'elevation', label: 'Elevation Gain', color: 'var(--hike)', unit: 'm' },
  { id: 'calories', label: 'Calories', color: 'var(--accent)', unit: 'kcal' },
  { id: 'speed', label: 'Avg Speed', color: 'var(--swim)', unit: 'km/h', format: v => v.toFixed(1) },
  { id: 'steps', label: 'Steps', color: 'var(--strength)', unit: '', format: v => Math.round(v).toLocaleString() },
]

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Sortable key for the Monday-anchored week a YYYY-MM-DD date falls in. */
function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [yr, mo] = key.split('-')
  return `${MONTH_NAMES[Number(mo) - 1]} ${yr.slice(2)}`
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

export default function Timeline() {
  const { workouts } = useWorkouts()
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'All'>('Run')
  const [selectedMetrics, setSelectedMetrics] = useLocalStorage<Metric[]>('al_tl_metrics', ['pace', 'hr'])
  const [rangeDays, setRangeDays] = useLocalStorage<number>('al_tl_range', 30)
  const [volumeBucket, setVolumeBucket] = useLocalStorage<'week' | 'month'>('al_tl_bucket', 'week')
  const [volumeMeasure, setVolumeMeasure] = useLocalStorage<'distance' | 'time'>('al_tl_vol', 'distance')

  const data = useMemo(() => {
    const inRange = filterByRange(workouts, rangeDays)
    const filtered = typeFilter === 'All' ? inRange : inRange.filter(w => w.type === typeFilter)
    return [...filtered]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(w => ({
        date: w.date,
        dateLabel: new Date(w.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
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
  }, [workouts, typeFilter, rangeDays])

  // Volume: distance (or time) totalled per week or per month, with a
  // 4-bucket moving average drawn over the bars. Bars and line share one unit
  // and therefore one axis — no second scale to misread.
  const volume = useMemo(() => {
    const buckets = new Map<string, number>()
    for (const w of data) {
      const key = volumeBucket === 'month' ? w.date.slice(0, 7) : weekKey(w.date)
      const value = volumeMeasure === 'distance' ? w.distance / 1000 : w.duration / 3600
      buckets.set(key, (buckets.get(key) ?? 0) + value)
    }
    const rows = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    return rows.map(([key, value], i) => {
      const window = rows.slice(Math.max(0, i - 3), i + 1)
      return {
        label: volumeBucket === 'month' ? monthLabel(key) : key.slice(5),
        key,
        value: Math.round(value * 10) / 10,
        avg: Math.round((window.reduce((a, [, v]) => a + v, 0) / window.length) * 10) / 10,
      }
    })
  }, [data, volumeBucket, volumeMeasure])

  // Efficiency: two views of the same idea — how much heart rate a given speed
  // costs. Both trend downward as fitness improves.
  const efficiency = useMemo(() => {
    const usable = data.filter(d => d.hr > 0 && (d.speed ?? 0) > 0 && d.pace)
    if (usable.length === 0) return { rows: [], refHr: 0 }
    // The reference HR is this selection's median, so the adjusted pace lands
    // in the same range as the real paces and needs no configuration.
    const hrs = usable.map(d => d.hr).sort((a, b) => a - b)
    const refHr = hrs[Math.floor(hrs.length / 2)]
    const rows = usable.map(d => ({
      dateLabel: d.dateLabel,
      name: d.name,
      hrPerSpeed: Math.round((d.hr / (d.speed as number)) * 10) / 10,
      adjPace: Math.round((d.pace as number) * (refHr / d.hr)),
      pace: d.pace as number,
      hr: d.hr,
      speed: d.speed as number,
    }))
    return { rows, refHr }
  }, [data])

  function toggleMetric(m: Metric) {
    setSelectedMetrics(prev =>
      prev.includes(m)
        ? prev.filter(x => x !== m)
        : [...prev, m]
    )
  }

  // Moving average
  const dataWithMA = useMemo(() => {
    const window = 3
    return data.map((d, i) => {
      const slice = data.slice(Math.max(0, i - window + 1), i + 1)
      const result: Record<string, number | null | string> = { ...d }
      for (const m of METRICS) {
        const vals = slice.map(s => s[m.id]).filter(v => v !== null) as number[]
        result[`${m.id}_ma`] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      }
      return result
    })
  }, [data])

  function formatValue(metric: Metric, value: number): string {
    const m = METRICS.find(x => x.id === metric)!
    return m.format ? m.format(value) : value.toFixed(0)
  }

  // Summary stats
  const summaryStats = useMemo(() => {
    if (data.length === 0) return []
    return METRICS.filter(m => selectedMetrics.includes(m.id)).map(m => {
      const vals = data.map(d => d[m.id]).filter(v => v !== null) as number[]
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length
      const min = Math.min(...vals)
      const max = Math.max(...vals)
      const trend = vals.length > 3
        ? ((vals[vals.length - 1] - vals[0]) / vals[0]) * 100
        : 0
      return { ...m, avg, min, max, trend }
    })
  }, [data, selectedMetrics])

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Timeline</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Trends over time</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <TypeDropdown value={typeFilter} onChange={v => setTypeFilter(v)} />
          <RangeDropdown value={rangeDays} onChange={setRangeDays} />
        </div>
      </div>

      <div className="page-content">
        {/* Metric toggle chips */}
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

        {/* Summary stat cards */}
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
                  <span style={{ color: s.trend > 0 ? '#22c55e' : s.trend < 0 ? '#ef4444' : 'var(--text-3)', marginLeft: 'auto' }}>
                    {s.trend > 0 ? '▲' : s.trend < 0 ? '▼' : '—'} {Math.abs(s.trend).toFixed(1)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Main chart */}
        {data.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px', color: 'var(--text-3)' }}>
            No {typeFilter === 'All' ? '' : `${typeFilter.toLowerCase()} `}activities in the {rangeLabel(rangeDays)}
          </div>
        ) : (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600 }}>Performance Over Time</h3>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{data.length} activities · 3-activity moving avg shown</span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dataWithMA} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                {/* EdgeTick anchors the first and last labels inward; with the
                    default centred anchor the final date ran off the right
                    edge of the plot and was clipped. */}
                <XAxis
                  dataKey="dateLabel"
                  tick={<EdgeTick />}
                  axisLine={false} tickLine={false}
                  interval={Math.max(0, Math.ceil(data.length / 8) - 1)}
                />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
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
                    <Line
                      key={metricId}
                      type="monotone"
                      dataKey={metricId}
                      stroke={m.color}
                      strokeWidth={1.5}
                      dot={{ r: 3, fill: m.color, strokeWidth: 0 }}
                      connectNulls
                      opacity={0.4}
                    />,
                    <Line
                      key={`${metricId}_ma`}
                      type="monotone"
                      dataKey={`${metricId}_ma`}
                      stroke={m.color}
                      strokeWidth={2.5}
                      dot={false}
                      connectNulls
                    />,
                  ]
                })}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Training volume: bars per bucket with a moving average over them.
            Both are the same measure on one axis — a second scale for the
            trend line would only invite misreading. */}
        <div className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>Training Volume</h3>
            <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>4-bucket moving average</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <Segmented
                value={volumeMeasure} onChange={setVolumeMeasure}
                options={[{ id: 'distance', label: 'Distance' }, { id: 'time', label: 'Time' }]}
              />
              <Segmented
                value={volumeBucket} onChange={setVolumeBucket}
                options={[{ id: 'week', label: 'Weekly' }, { id: 'month', label: 'Monthly' }]}
              />
            </div>
          </div>
          {volume.length === 0 ? (
            <EmptyPlot height={200}>No activities in the {rangeLabel(rangeDays)}</EmptyPlot>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={volume} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" tick={<EdgeTick fontSize={9} />} axisLine={false} tickLine={false} interval={Math.max(0, Math.ceil(volume.length / 8) - 1)} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} unit={volumeMeasure === 'distance' ? 'km' : 'h'} />
                <Tooltip
                  cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    const unit = volumeMeasure === 'distance' ? 'km' : 'h'
                    return (
                      <div className="custom-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>
                          {volumeBucket === 'week' ? `Week of ${d.key}` : d.label}
                        </div>
                        <div style={{ color: 'var(--primary)' }}>{d.value} {unit}</div>
                        <div style={{ color: 'var(--text-3)' }}>Avg {d.avg} {unit}</div>
                      </div>
                    )
                  }}
                />
                <Bar dataKey="value" fill="var(--primary)" opacity={0.35} radius={[3, 3, 0, 0]} maxBarSize={40} isAnimationActive={false} />
                <Line type="monotone" dataKey="avg" stroke="var(--primary)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Efficiency: two framings of "what does speed cost me in heartbeats". */}
        <div className="grid-2" style={{ marginTop: 16 }}>
          <div className="card">
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Efficiency Factor</h3>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
              Heartbeats spent per km/h of speed. A falling line means the same speed is costing you less effort.
            </p>
            {efficiency.rows.length === 0 ? (
              <EmptyPlot height={200}>Needs activities with both heart rate and speed</EmptyPlot>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={efficiency.rows} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="dateLabel" tick={<EdgeTick fontSize={9} />} axisLine={false} tickLine={false} interval={Math.max(0, Math.ceil(efficiency.rows.length / 6) - 1)} />
                  <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} domain={['dataMin - 1', 'dataMax + 1']} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div className="custom-tooltip">
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                          <div style={{ color: 'var(--text-3)' }}>{d.dateLabel}</div>
                          <div style={{ color: '#ef4444' }}>{d.hrPerSpeed} bpm per km/h</div>
                          <div style={{ color: 'var(--text-3)' }}>{d.hr} bpm · {d.speed.toFixed(1)} km/h</div>
                        </div>
                      )
                    }}
                  />
                  <Line type="monotone" dataKey="hrPerSpeed" stroke="#ef4444" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className="card">
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Pace at Fixed HR</h3>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
              Each activity's pace rescaled to {efficiency.refHr || '—'} bpm (this selection's median), so easy and
              hard days compare directly. Lower is fitter.
            </p>
            {efficiency.rows.length === 0 ? (
              <EmptyPlot height={200}>Needs activities with both heart rate and pace</EmptyPlot>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={efficiency.rows} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                  <CartesianGrid {...GRID_PROPS} />
                  <XAxis dataKey="dateLabel" tick={<EdgeTick fontSize={9} />} axisLine={false} tickLine={false} interval={Math.max(0, Math.ceil(efficiency.rows.length / 6) - 1)} />
                  <YAxis
                    tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} reversed
                    domain={['dataMin - 15', 'dataMax + 15']} tickFormatter={v => fmtPace(v)}
                  />
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
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyPlot({ height, children }: { height: number; children: React.ReactNode }) {
  return (
    <div style={{ height, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--text-3)', textAlign: 'center', padding: '0 16px' }}>
      {children}
    </div>
  )
}
