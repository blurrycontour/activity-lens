import { useMemo, useState } from 'react'
import { TYPE_COLOR, fmtPace, type WorkoutType, type Workout } from '../data/workouts'
import { useWorkouts } from '../context/WorkoutsContext'
import TypeDropdown from '../components/TypeDropdown'
import {
  ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar,
} from 'recharts'
import { TrendingUp, Award, Target, Zap } from 'lucide-react'

type PR = { longest: Workout; fastest: Workout | null; highest: Workout }

export default function Analysis() {
  const { workouts } = useWorkouts()
  const [scatterType, setScatterType] = useState<WorkoutType | 'All'>('Run')

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

    // HR vs Pace scatter data (runs only)

    // Calories by type bar
    const calByType = (['Run', 'Ride', 'Hike', 'Swim', 'Strength'] as WorkoutType[]).map(t => ({
      type: t,
      total: Math.round(workouts.filter(w => w.type === t).reduce((a, w) => a + w.calories, 0)),
      count: workouts.filter(w => w.type === t).length,
      fill: TYPE_COLOR[t],
    })).filter(d => d.count > 0)

    // Training load (TSS-equivalent, 60 days)
    const trainingLoad: { date: string; tss: number; load: number }[] = []
    for (let i = 60; i >= 0; i--) {
      const dt = new Date()
      dt.setDate(dt.getDate() - i)
      const ds = dt.toISOString().split('T')[0]
      const dayW = workouts.filter(w => w.date === ds)
      const tss = dayW.reduce((a, w) => a + Math.round(w.duration / 3600 * w.avgHR / 150 * 100), 0)
      trainingLoad.push({ date: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), tss, load: Math.round(tss * 0.85) })
    }

    return { PRs, calByType, trainingLoad }
  }, [workouts])

  // HR vs Pace scatter data, filterable by activity type (or all combined).
  const scatterData = useMemo(() =>
    workouts
      .filter(w => (scatterType === 'All' || w.type === scatterType) && w.avgPace > 0)
      .map(w => ({ hr: w.avgHR, pace: Math.round(w.avgPace / 6) / 10, name: w.name, date: w.date, dist: (w.distance / 1000).toFixed(1) })),
  [workouts, scatterType])

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Analysis</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>Performance insights</span>
        </div>
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

        {/* HR vs Pace scatter */}
        <div className="grid-2" style={{ marginBottom: 24 }}>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              <Target size={14} color="var(--primary)" />
              <h3 style={{ fontSize: 13, fontWeight: 600 }}>HR vs Pace</h3>
              <div style={{ marginLeft: 'auto' }}>
                <TypeDropdown value={scatterType} onChange={setScatterType} />
              </div>
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 12 }}>Lower HR at faster pace = improved aerobic efficiency</p>
            <ResponsiveContainer width="100%" height={200}>
              <ScatterChart margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" />
                <XAxis dataKey="pace" name="Pace" unit=" min/km" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <YAxis dataKey="hr" name="HR" unit=" bpm" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="custom-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.name}</div>
                        <div style={{ color: 'var(--text-3)' }}>{d.date}</div>
                        <div>Pace: {d.pace} min/km</div>
                        <div>HR: {d.hr} bpm</div>
                        <div>Dist: {d.dist} km</div>
                      </div>
                    )
                  }}
                />
                <Scatter data={scatterData} fill="var(--primary)" opacity={0.7} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>

          {/* Calories by type */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
              <Zap size={14} color="var(--accent)" />
              <h3 style={{ fontSize: 13, fontWeight: 600 }}>Total Calories by Type</h3>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={calByType} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="type" tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                <Tooltip
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
                {calByType.map(d => (
                  <Bar key={d.type} dataKey="total" fill={d.fill} radius={[4, 4, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Training load */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
            <TrendingUp size={14} color="var(--blue)" />
            <h3 style={{ fontSize: 13, fontWeight: 600 }}>Training Load (60 days)</h3>
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>TSS-equivalent score</span>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={trainingLoad.filter((_, i) => i % 2 === 0)} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 9, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} interval={6} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return <div className="custom-tooltip"><div>{d.date}</div><div style={{ color: 'var(--blue)' }}>TSS {d.tss}</div></div>
                }}
              />
              <Bar dataKey="tss" fill="var(--blue)" radius={[2, 2, 0, 0]} opacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}
