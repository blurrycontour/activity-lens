import { useState, useMemo } from 'react'
import { workouts, fmtPace, type WorkoutType } from '../data/workouts'
import TypeDropdown from '../components/TypeDropdown'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid,
} from 'recharts'

type Metric = 'pace' | 'hr' | 'distance' | 'duration' | 'elevation' | 'calories'

const METRICS: { id: Metric; label: string; color: string; unit: string; format?: (v: number) => string }[] = [
  { id: 'pace', label: 'Avg Pace', color: 'var(--primary)', unit: '/km', format: fmtPace },
  { id: 'hr', label: 'Avg HR', color: '#ef4444', unit: 'bpm' },
  { id: 'distance', label: 'Distance', color: 'var(--blue)', unit: 'km', format: v => (v / 1000).toFixed(1) },
  { id: 'duration', label: 'Duration', color: 'var(--purple)', unit: 'min', format: v => Math.round(v / 60).toString() },
  { id: 'elevation', label: 'Elevation Gain', color: 'var(--hike)', unit: 'm' },
  { id: 'calories', label: 'Calories', color: 'var(--accent)', unit: 'kcal' },
]

export default function Timeline() {
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'All'>('Run')
  const [selectedMetrics, setSelectedMetrics] = useState<Metric[]>(['pace', 'hr'])

  const data = useMemo(() => {
    const filtered = typeFilter === 'All' ? workouts : workouts.filter(w => w.type === typeFilter)
    return [...filtered]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .filter(w => typeFilter === 'All' || w.type === typeFilter)
      .map(w => ({
        date: w.date,
        dateLabel: new Date(w.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        pace: w.avgPace || null,
        hr: w.avgHR,
        distance: w.distance,
        duration: w.duration,
        elevation: w.elevationGain,
        calories: w.calories,
        name: w.name,
        type: w.type,
      }))
  }, [typeFilter])

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
        <TypeDropdown value={typeFilter} onChange={v => setTypeFilter(v)} />
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
            No data for this activity type
          </div>
        ) : (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600 }}>Performance Over Time</h3>
              <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{data.length} activities · 3-activity moving avg shown</span>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={dataWithMA} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}
                  axisLine={false} tickLine={false}
                  interval={Math.max(1, Math.floor(data.length / 8))}
                />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
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
      </div>
    </div>
  )
}
