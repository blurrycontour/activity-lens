import { useMemo } from 'react'
import { useWorkouts } from '../context/WorkoutsContext'
import { fmtDuration, fmtDist, fmtPace, TYPE_COLOR, TYPE_ICON, type Workout } from '../data/workouts'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadialBarChart, RadialBar,
} from 'recharts'
import { TrendingUp, Zap, Flame, Clock, Mountain, Heart } from 'lucide-react'
import { useLocalStorage } from '../lib/useLocalStorage'
import {
  DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG, windowLabel,
  type DashboardConfig, type StatCardId,
} from '../lib/dashboardConfig'

function StatCard({ icon, label, value, unit, sub }: { icon: React.ReactNode; label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: 'var(--text-3)' }}>{icon}</span>
        <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-mono)', letterSpacing: '-0.04em', color: 'var(--text)' }}>{value}</span>
        {unit && <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{unit}</span>}
      </div>
      {sub && <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{sub}</span>}
    </div>
  )
}

function WorkoutRow({ w }: { w: Workout }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 0', borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: `${TYPE_COLOR[w.type]}20`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 18,
      }}>
        {TYPE_ICON[w.type]}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 1 }}>{new Date(w.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600 }}>{fmtDist(w.distance)}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)' }}>{fmtDuration(w.duration)}</div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { workouts, loading } = useWorkouts()
  const [cfg] = useLocalStorage<DashboardConfig>(DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG)

  const d = useMemo(() => {
    const sorted = [...workouts].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)
    const last30 = sorted.filter(w => new Date(w.date) >= cutoff)

    // Windowed set used by the configurable stat cards and the activity mix.
    let windowed = workouts
    if (cfg.windowDays > 0) {
      const wc = new Date()
      wc.setDate(wc.getDate() - cfg.windowDays)
      windowed = workouts.filter(w => new Date(w.date) >= wc)
    }

    const typeCount: Record<string, number> = {}
    for (const w of windowed) typeCount[w.type] = (typeCount[w.type] || 0) + 1

    const totalDist = windowed.reduce((a, w) => a + w.distance, 0)
    const totalTime = windowed.reduce((a, w) => a + w.duration, 0)
    const totalElev = windowed.reduce((a, w) => a + w.elevationGain, 0)
    const totalCal = windowed.reduce((a, w) => a + w.calories, 0)
    const avgHR = windowed.length ? Math.round(windowed.reduce((a, w) => a + w.avgHR, 0) / windowed.length) : 0

    const weeklyData: { week: string; duration: number; count: number }[] = []
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - i * 7 - 6)
      const weekEnd = new Date(); weekEnd.setDate(weekEnd.getDate() - i * 7)
      const inWeek = workouts.filter(w => { const dt = new Date(w.date); return dt >= weekStart && dt <= weekEnd })
      weeklyData.push({
        week: `W${8 - i}`,
        duration: Math.round(inWeek.reduce((a, w) => a + w.duration, 0) / 3600 * 10) / 10,
        count: inWeek.length,
      })
    }

    const radialData = [
      { name: 'Run', value: typeCount['Run'] || 0, fill: 'var(--run)' },
      { name: 'Ride', value: typeCount['Ride'] || 0, fill: 'var(--ride)' },
      { name: 'Hike', value: typeCount['Hike'] || 0, fill: 'var(--hike)' },
      { name: 'Swim', value: typeCount['Swim'] || 0, fill: 'var(--swim)' },
      { name: 'Strength', value: typeCount['Strength'] || 0, fill: 'var(--strength)' },
    ]

    return { sorted, latest: sorted[0], last30, windowedCount: windowed.length, typeCount, totalDist, totalTime, totalElev, totalCal, avgHR, weeklyData, radialData }
  }, [workouts, cfg.windowDays])

  const caption = windowLabel(cfg.windowDays)

  const allCards: Record<StatCardId, React.ReactNode> = {
    distance: <StatCard key="distance" icon={<TrendingUp size={14} />} label="Total Distance" value={(d.totalDist / 1000).toFixed(0)} unit="km" sub={caption} />,
    time: <StatCard key="time" icon={<Clock size={14} />} label="Total Time" value={Math.floor(d.totalTime / 3600).toString()} unit="hrs" sub={caption} />,
    elevation: <StatCard key="elevation" icon={<Mountain size={14} />} label="Elevation" value={(d.totalElev / 1000).toFixed(1)} unit="km" sub="total gain" />,
    calories: <StatCard key="calories" icon={<Flame size={14} />} label="Calories" value={(d.totalCal / 1000).toFixed(1)} unit="kcal ×1k" sub="energy expended" />,
    avgHr: <StatCard key="avgHr" icon={<Heart size={14} />} label="Avg Heart Rate" value={d.avgHR.toString()} unit="bpm" sub={caption} />,
    activities: <StatCard key="activities" icon={<Zap size={14} />} label="Activities" value={d.windowedCount.toString()} unit="" sub={`${Object.keys(d.typeCount).length} sport types`} />,
  }

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Dashboard</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {d.windowedCount} activities · {caption}
          </span>
        </div>
      </div>

      <div className="page-content">
        {loading && workouts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)', fontSize: 13 }}>Loading…</div>
        ) : workouts.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
            <p style={{ fontSize: 14 }}>No workouts yet — import a file or add one manually to get started.</p>
          </div>
        ) : (
          <>
            {/* Stats grid (configurable) */}
            {cfg.cards.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
                {cfg.cards.map(id => allCards[id])}
              </div>
            )}

            <div className="grid-dash" style={{ marginBottom: 16 }}>
              {/* Weekly chart */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600 }}>Weekly Volume</h3>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>hours / week</span>
                </div>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={d.weeklyData} barSize={20} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} />
                    <Tooltip
                      cursor={{ fill: 'var(--bg-3)', opacity: 0.5 }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const p = payload[0].payload
                        return (
                          <div className="custom-tooltip">
                            <div style={{ color: 'var(--text-2)' }}>{p.week}</div>
                            <div style={{ color: 'var(--primary)', fontWeight: 600 }}>{p.duration}h · {p.count} activities</div>
                          </div>
                        )
                      }}
                    />
                    <Bar dataKey="duration" fill="var(--primary)" radius={[4, 4, 0, 0]} opacity={0.85} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Radial type breakdown: legend on the left, chart on the right (desktop) */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ fontSize: 13, fontWeight: 600 }}>Activity Mix</h3>
                  <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{caption}</span>
                </div>
                <div className="activity-mix-body">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center', width: 150 }}>
                    {d.radialData.map(r => (
                      <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: r.fill }} />
                          <span style={{ fontSize: 13, color: 'var(--text-2)' }}>{r.name}</span>
                        </div>
                        <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{r.value}</span>
                      </div>
                    ))}
                  </div>
                  <ResponsiveContainer width="100%" height={150}>
                    <RadialBarChart innerRadius={24} outerRadius={70} data={d.radialData} startAngle={90} endAngle={-270}>
                      <RadialBar dataKey="value" background={{ fill: 'var(--bg-3)' }} />
                    </RadialBarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Latest workout + recent list */}
            <div className="grid-2">
              {d.latest && (
                <div className="card" style={{ background: 'var(--bg-2)', position: 'relative', overflow: 'hidden' }}>
                  <div style={{
                    position: 'absolute', top: 0, right: 0, width: 120, height: 120,
                    background: `radial-gradient(circle at 80% 20%, ${TYPE_COLOR[d.latest.type]}18 0%, transparent 70%)`,
                    pointerEvents: 'none',
                  }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Latest Activity</div>
                      <h3 style={{ fontSize: 15, fontWeight: 700 }}>{d.latest.name}</h3>
                      <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>{new Date(d.latest.date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div>
                    </div>
                    <span className={`badge tag-${d.latest.type.toLowerCase()}`}>{TYPE_ICON[d.latest.type]} {d.latest.type}</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                    {[
                      { label: 'Distance', value: fmtDist(d.latest.distance) },
                      { label: 'Duration', value: fmtDuration(d.latest.duration) },
                      { label: 'Avg HR', value: `${d.latest.avgHR} bpm` },
                      { label: 'Elevation', value: `${Math.round(d.latest.elevationGain)} m` },
                      { label: 'Calories', value: `${d.latest.calories} kcal` },
                      { label: 'Avg Pace', value: d.latest.avgPace ? fmtPace(d.latest.avgPace) + ' /km' : `${d.latest.avgSpeed.toFixed(1)} km/h` },
                    ].map(s => (
                      <div key={s.label} className="stat-chip">
                        <span className="label">{s.label}</span>
                        <span className="value" style={{ fontSize: 14 }}>{s.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent list */}
              <div className="card">
                <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Recent Activities</h3>
                <div>
                  {d.sorted.slice(0, 5).map(w => <WorkoutRow key={w.id} w={w} />)}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
