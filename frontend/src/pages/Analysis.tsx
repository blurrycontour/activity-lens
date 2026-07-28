import { useMemo, useState } from 'react'
import { TYPE_COLOR, fmtPace, type WorkoutType, type Workout } from '../data/workouts'
import { useWorkouts } from '../context/WorkoutsContext'
import TypeDropdown from '../components/TypeDropdown'
import RangeDropdown from '../components/RangeDropdown'
import { useLocalStorage } from '../lib/useLocalStorage'
import { filterByRange, rangeLabel, toDateKey } from '../lib/range'
import { AXIS_TICK, GRID_PROPS, HOVER_FILL } from '../lib/chartColors'
import { EdgeTick } from '../components/ChartAxis'
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Cell, LineChart, Line, ReferenceArea, ReferenceLine,
} from 'recharts'
import { TrendingUp, Award, Target, Zap, Activity, Navigation } from 'lucide-react'

type PR = { longest: Workout; fastest: Workout | null; highest: Workout }

/** TSS-equivalent for one workout: duration scaled by relative heart-rate effort. */
function loadOf(w: Workout): number {
  return Math.round(w.duration / 3600 * w.avgHR / 150 * 100)
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

export default function Analysis() {
  const { workouts: allWorkouts } = useWorkouts()
  const [scatterType, setScatterType] = useState<WorkoutType | 'All'>('Run')
  const [rangeDays, setRangeDays] = useLocalStorage<number>('al_an_range', 30)

  const workouts = useMemo(() => filterByRange(allWorkouts, rangeDays), [allWorkouts, rangeDays])

  const { PRs, calByType, trainingLoad } = useMemo(() => {
    // Personal records per type
    const PRs: Partial<Record<WorkoutType, PR>> = {}
    for (const type of ['Run', 'Ride', 'Hike', 'Swim', 'Strength'] as WorkoutType[]) {
      const tw = workouts.filter(w => w.type === type)
      if (tw.length === 0) continue
      PRs[type] = {
        longest: tw.reduce((a, b) => a.distance > b.distance ? a : b),
        fastest: tw.filter(w => w.avgPace).length > 0 ? tw.filter(w => w.avgPace).reduce((a, b) => a.avgPace < b.avgPace ? a : b) : null,
        highest: tw.reduce((a, b) => a.elevationGain > b.elevationGain ? a : b),
      }
    }

    // Calories by type: one bar per type, coloured per type via Cell. A
    // separate <Bar> per type would create one series each and leave every bar
    // offset in its own slot rather than centred on its category.
    const calByType = (['Run', 'Ride', 'Hike', 'Swim', 'Strength'] as WorkoutType[]).map(t => ({
      type: t,
      total: Math.round(workouts.filter(w => w.type === t).reduce((a, w) => a + w.calories, 0)),
      count: workouts.filter(w => w.type === t).length,
      fill: TYPE_COLOR[t],
    })).filter(d => d.count > 0)

    // Training load (TSS-equivalent), one bar per day across the selected
    // range. All-time is capped at a year so the chart stays legible.
    const loadDays = Math.min(rangeDays > 0 ? rangeDays : 365, 365)
    const byDate = new Map<string, number>()
    for (const w of workouts) {
      byDate.set(w.date, (byDate.get(w.date) ?? 0) + loadOf(w))
    }
    const trainingLoad: { date: string; tss: number }[] = []
    for (let i = loadDays - 1; i >= 0; i--) {
      const dt = new Date()
      dt.setDate(dt.getDate() - i)
      trainingLoad.push({
        date: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        tss: byDate.get(toDateKey(dt)) ?? 0,
      })
    }

    return { PRs, calByType, trainingLoad }
  }, [workouts, rangeDays])

  // HR vs Pace scatter, filterable by activity type (or all combined). Pace is
  // kept in seconds/km — the chart's native unit — and formatted as m:ss on the
  // axis and in the tooltip, rather than shown as ambiguous decimal minutes.
  const scatterData = useMemo(() =>
    workouts
      .filter(w => (scatterType === 'All' || w.type === scatterType) && w.avgPace > 0)
      .map(w => ({
        hr: w.avgHR,
        pace: Math.round(w.avgPace),
        distKm: Math.round(w.distance / 100) / 10,
        name: w.name,
        date: w.date,
      })),
  [workouts, scatterType])

  // Distance vs pace: does pace hold up as the distance grows?
  const distPaceData = useMemo(() =>
    workouts
      .filter(w => (scatterType === 'All' || w.type === scatterType) && w.avgPace > 0 && w.distance > 0)
      .map(w => ({
        km: Math.round(w.distance / 100) / 10,
        pace: Math.round(w.avgPace),
        hr: w.avgHR,
        name: w.name,
        date: w.date,
      })),
  [workouts, scatterType])

  // Acute:chronic workload ratio. Both averages are computed from the full
  // library, not the visible range, because the 28-day chronic figure needs
  // four weeks of history that sit before the window starts.
  const acwr = useMemo(() => {
    const byDate = new Map<string, number>()
    for (const w of allWorkouts) {
      byDate.set(w.date, (byDate.get(w.date) ?? 0) + loadOf(w))
    }
    const days = Math.min(rangeDays > 0 ? rangeDays : 365, 365)
    // One pass over the calendar: daily loads oldest-first, covering the
    // visible window plus the 27 days of lead-in the chronic average needs.
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

    const out: { date: string; acute: number; chronic: number; ratio: number | null }[] = []
    for (let end = span - days; end < span; end++) {
      const acute = meanEndingAt(end, 7)
      const chronic = meanEndingAt(end, 28)
      out.push({
        date: labels[end],
        acute: Math.round(acute),
        chronic: Math.round(chronic),
        ratio: chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null,
      })
    }
    return out
  }, [allWorkouts, rangeDays])

  const latestRatio = [...acwr].reverse().find(d => d.ratio != null)?.ratio ?? null
  const tickInterval = (n: number) => Math.max(0, Math.ceil(n / 8) - 1)

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Analysis</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            Performance insights · {workouts.length} activities
          </span>
        </div>
        <RangeDropdown value={rangeDays} onChange={setRangeDays} />
      </div>

      <div className="page-content">
        {/* Personal Records */}
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Award size={16} color="var(--primary)" /> Personal Records
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10, marginBottom: 24 }}>
          {(Object.entries(PRs) as [WorkoutType, NonNullable<typeof PRs[WorkoutType]>][]).map(([type, pr]) => (
            <div key={type} className="card" style={{ borderTop: `3px solid ${TYPE_COLOR[type]}` }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: TYPE_COLOR[type] }}>{type}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Longest</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{(pr.longest.distance / 1000).toFixed(1)} km</span>
                </div>
                {pr.fastest && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Best Pace</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>
                      {fmtPace(pr.fastest.avgPace)} /km
                    </span>
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-3)' }}>Most Elevation</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{Math.round(pr.highest.elevationGain)} m</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Scatter plots share one activity-type filter, shown on the first. */}
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <Target size={14} color="var(--primary)" />
              <h3 style={{ fontSize: 13, fontWeight: 600 }}>HR vs Pace</h3>
              <div style={{ marginLeft: 'auto' }}>
                <TypeDropdown value={scatterType} onChange={setScatterType} />
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>Lower HR at faster pace = improved aerobic efficiency. Marker size is distance.</p>
            {scatterData.length === 0 ? (
              <EmptyPlot height={230}>No paced activities in the {rangeLabel(rangeDays)}</EmptyPlot>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                {/* Units live in the axis labels rather than on every tick: with
                    " bpm" appended to each value the labels grew wide enough to
                    be clipped by the plot area. */}
                <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
                  <CartesianGrid {...GRID_PROPS} vertical />
                  <XAxis
                    type="number" dataKey="pace" name="Pace" domain={['dataMin - 20', 'dataMax + 20']}
                    tick={AXIS_TICK} axisLine={false} tickLine={false} reversed
                    tickFormatter={v => fmtPace(v)} label={xLabel('Pace (min/km) — faster →')}
                  />
                  <YAxis
                    type="number" dataKey="hr" name="HR" domain={['dataMin - 5', 'dataMax + 5']} width={44}
                    tick={AXIS_TICK} axisLine={false} tickLine={false} label={yLabel('HR (bpm)')}
                  />
                  {/* Marker area encodes distance, so long efforts stand out. */}
                  <ZAxis type="number" dataKey="distKm" range={[40, 220]} name="Distance" />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-strong)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div className="custom-tooltip">
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                          <div style={{ color: 'var(--text-3)' }}>{d.date}</div>
                          <div>Pace: {fmtPace(d.pace)} /km</div>
                          <div>HR: {d.hr} bpm</div>
                          <div>Distance: {d.distKm} km</div>
                        </div>
                      )
                    }}
                  />
                  <Scatter data={scatterData} fill="var(--primary)" opacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Distance vs pace */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Navigation size={14} color="var(--blue)" />
              <h3 style={{ fontSize: 13, fontWeight: 600 }}>Distance vs Pace</h3>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>A flat cloud means pace holds up as distance grows; a rising one means long efforts cost you speed.</p>
            {distPaceData.length === 0 ? (
              <EmptyPlot height={230}>No paced activities in the {rangeLabel(rangeDays)}</EmptyPlot>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
                  <CartesianGrid {...GRID_PROPS} vertical />
                  <XAxis
                    type="number" dataKey="km" name="Distance" domain={['dataMin - 1', 'dataMax + 1']}
                    tick={AXIS_TICK} axisLine={false} tickLine={false} label={xLabel('Distance (km)')}
                  />
                  <YAxis
                    type="number" dataKey="pace" name="Pace" domain={['dataMin - 20', 'dataMax + 20']} width={44}
                    tick={AXIS_TICK} axisLine={false} tickLine={false} reversed
                    tickFormatter={v => fmtPace(v)} label={yLabel('Pace (min/km)')}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3', stroke: 'var(--border-strong)' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div className="custom-tooltip">
                          <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                          <div style={{ color: 'var(--text-3)' }}>{d.date}</div>
                          <div>Distance: {d.km} km</div>
                          <div>Pace: {fmtPace(d.pace)} /km</div>
                          <div>HR: {d.hr || '—'} bpm</div>
                        </div>
                      )
                    }}
                  />
                  <Scatter data={distPaceData} fill="var(--blue)" opacity={0.6} />
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Calories by type */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
            <Zap size={14} color="var(--accent)" />
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>Total Calories by Type</h3>
          </div>
          {calByType.length === 0 ? (
            <EmptyPlot height={200}>No activities in the {rangeLabel(rangeDays)}</EmptyPlot>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={calByType} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="type" tick={{ ...AXIS_TICK, fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={48} tickFormatter={v => v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`} />
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
        </div>

        {/* Training load */}
        <div className="card" style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <TrendingUp size={14} color="var(--blue)" />
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>Training Load</h3>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>TSS-equivalent score</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={trainingLoad} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={<EdgeTick fontSize={9} />} axisLine={false} tickLine={false} interval={tickInterval(trainingLoad.length)} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} />
              <Tooltip
                cursor={{ fill: HOVER_FILL, opacity: 0.6 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return <div className="custom-tooltip"><div>{d.date}</div><div style={{ color: 'var(--blue)' }}>TSS {d.tss}</div></div>
                }}
              />
              <Bar dataKey="tss" fill="var(--blue)" radius={[2, 2, 0, 0]} opacity={0.8} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Acute:chronic workload ratio */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <Activity size={14} color="var(--purple)" />
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>Acute : Chronic Workload</h3>
            {latestRatio != null && (
              <span style={{
                marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
                color: latestRatio > 1.5 ? '#ef4444' : latestRatio < 0.8 ? 'var(--text-3)' : '#22c55e',
              }}>
                {latestRatio.toFixed(2)} today
              </span>
            )}
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>
            Last 7 days of load against the last 28. The shaded band (0.8–1.3) is the range where
            you're building fitness without ramping up faster than your body adapts.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={acwr} margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="date" tick={<EdgeTick fontSize={9} />} axisLine={false} tickLine={false} interval={tickInterval(acwr.length)} />
              <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={40} domain={[0, (max: number) => Math.max(2, Math.ceil(max * 10) / 10)]} />
              <ReferenceArea y1={0.8} y2={1.3} fill="#22c55e" fillOpacity={0.1} />
              <ReferenceLine y={1.5} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.6} />
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
        </div>
      </div>
    </div>
  )
}

function EmptyPlot({ height, children }: { height: number; children: React.ReactNode }) {
  return (
    <div style={{ height, display: 'grid', placeItems: 'center', fontSize: 12, color: 'var(--text-3)', textAlign: 'center' }}>
      {children}
    </div>
  )
}
