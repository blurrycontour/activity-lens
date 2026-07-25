import { useMemo, useState } from 'react'
import { type WorkoutType } from '../data/workouts'
import { useWorkouts } from '../context/WorkoutsContext'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Heatmap() {
  const { workouts } = useWorkouts()
  const [hoveredDay, setHoveredDay] = useState<{ date: string; count: number; duration: number } | null>(null)
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'All'>('All')

  const filteredWorkouts = typeFilter === 'All' ? workouts : workouts.filter(w => w.type === typeFilter)

  const { grid, months, maxCount } = useMemo(() => {
    const activityMap: Record<string, { count: number; duration: number; types: WorkoutType[] }> = {}
    for (const w of filteredWorkouts) {
      if (!activityMap[w.date]) activityMap[w.date] = { count: 0, duration: 0, types: [] }
      activityMap[w.date].count++
      activityMap[w.date].duration += w.duration
      activityMap[w.date].types.push(w.type)
    }

    const today = new Date()
    const endDate = new Date(today)
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - 364)
    // Align to Sunday
    while (startDate.getDay() !== 0) startDate.setDate(startDate.getDate() - 1)

    const weeks: Array<Array<{ date: string; count: number; duration: number; isCurrentMonth: boolean } | null>> = []
    const monthLabels: { label: string; col: number }[] = []
    let currentDate = new Date(startDate)
    let col = 0
    let lastMonth = -1

    while (currentDate <= endDate) {
      const week: Array<{ date: string; count: number; duration: number; isCurrentMonth: boolean } | null> = []
      for (let d = 0; d < 7; d++) {
        if (currentDate <= endDate) {
          const dateStr = currentDate.toISOString().split('T')[0]
          const data = activityMap[dateStr] || { count: 0, duration: 0 }
          const month = currentDate.getMonth()
          if (month !== lastMonth && d === 0) {
            monthLabels.push({ label: MONTHS[month], col })
            lastMonth = month
          }
          week.push({ date: dateStr, count: data.count, duration: data.duration, isCurrentMonth: month === today.getMonth() })
          currentDate.setDate(currentDate.getDate() + 1)
        } else {
          week.push(null)
        }
      }
      weeks.push(week)
      col++
    }

    const maxC = Math.max(...Object.values(activityMap).map(v => v.count), 1)
    return { grid: weeks, months: monthLabels, maxCount: maxC }
  }, [filteredWorkouts])

  function getColor(count: number): string {
    if (count === 0) return 'var(--bg-3)'
    const intensity = Math.min(count / maxCount, 1)
    if (intensity < 0.25) return 'rgba(0,232,122,0.2)'
    if (intensity < 0.5) return 'rgba(0,232,122,0.45)'
    if (intensity < 0.75) return 'rgba(0,232,122,0.7)'
    return 'var(--primary)'
  }

  // Monthly breakdown
  const monthlyStats = useMemo(() => {
    const stats: Record<string, { count: number; duration: number; distance: number }> = {}
    for (const w of filteredWorkouts) {
      const key = w.date.slice(0, 7)
      if (!stats[key]) stats[key] = { count: 0, duration: 0, distance: 0 }
      stats[key].count++
      stats[key].duration += w.duration
      stats[key].distance += w.distance
    }
    return Object.entries(stats).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6)
  }, [filteredWorkouts])

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Heatmap</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>365 days of activity</span>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['All', 'Run', 'Ride', 'Hike', 'Swim', 'Strength'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTypeFilter(t as typeof typeFilter)}
              style={{
                padding: '4px 10px', borderRadius: 99, border: 'none', fontSize: 12,
                fontWeight: 500, cursor: 'pointer',
                background: typeFilter === t ? 'var(--primary)' : 'var(--bg-3)',
                color: typeFilter === t ? '#0a0b0e' : 'var(--text-2)',
                transition: 'all 0.12s',
              }}
            >
              {t}
            </button>
          ))}
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
              {DAYS.map((d, i) => (
                <div key={d} style={{
                  height: 14, lineHeight: '14px',
                  fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-3)',
                  opacity: i % 2 === 0 ? 1 : 0,
                  width: 20, textAlign: 'right',
                }}>
                  {d}
                </div>
              ))}
            </div>

            <div style={{ flex: 1, minWidth: grid.length * 12 }}>
              {/* Month labels */}
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${grid.length}, 1fr)`, height: 14, marginBottom: 2 }}>
                {months.map((m, i) => (
                  <div
                    key={i}
                    style={{
                      gridColumnStart: m.col + 1,
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--text-3)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {m.label}
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
                          background: day ? getColor(day.count) : 'transparent',
                          border: day && day.count > 0 ? `1px solid rgba(255,255,255,0.1)` : 'none',
                          cursor: day && day.count > 0 ? 'pointer' : 'default',
                          transition: 'transform 0.1s',
                          position: 'relative',
                        }}
                        onMouseEnter={() => day && day.count > 0 && setHoveredDay(day)}
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
              <div key={v} style={{ width: 14, height: 14, borderRadius: 2, background: getColor(v === 0 ? 0 : Math.ceil(v * maxCount)) }} />
            ))}
            <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>More</span>
          </div>

          {hoveredDay && (
            <div style={{
              position: 'fixed',
              bottom: 80, right: 24,
              background: 'var(--bg-2)', border: '1px solid var(--border-strong)',
              borderRadius: 8, padding: '10px 14px', zIndex: 100,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--primary)', marginBottom: 4 }}>{hoveredDay.date}</div>
              <div style={{ fontSize: 12, color: 'var(--text-2)' }}>{hoveredDay.count} activity · {Math.round(hoveredDay.duration / 60)} min</div>
            </div>
          )}
        </div>

        {/* Monthly breakdown */}
        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Monthly Breakdown</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
            {monthlyStats.map(([month, stats]) => {
              const [yr, mo] = month.split('-')
              const label = `${MONTHS[parseInt(mo) - 1]} ${yr}`
              const maxDur = Math.max(...monthlyStats.map(([, s]) => s.duration))
              const pct = (stats.duration / maxDur) * 100
              return (
                <div key={month} className="card" style={{ padding: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--primary)', fontWeight: 700 }}>{stats.count} activities</span>
                  </div>
                  <div style={{ background: 'var(--bg-3)', borderRadius: 99, height: 4, marginBottom: 8 }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', borderRadius: 99, transition: 'width 0.4s ease' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{(stats.distance / 1000).toFixed(0)} km</span>
                    <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{Math.round(stats.duration / 3600)}h {Math.round((stats.duration % 3600) / 60)}m</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Week day distribution */}
        <div style={{ marginTop: 20 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Day of Week Distribution</h3>
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8 }}>
              {DAYS.map(day => {
                const count = filteredWorkouts.filter(w => new Date(w.date).getDay() === DAYS.indexOf(day)).length
                const maxC = Math.max(...DAYS.map(d => filteredWorkouts.filter(w => new Date(w.date).getDay() === DAYS.indexOf(d)).length))
                const h = maxC > 0 ? Math.max(8, (count / maxC) * 80) : 8
                return (
                  <div key={day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', height: 80 }}>
                      <div style={{
                        width: '100%', height: h,
                        background: count > 0 ? 'var(--primary)' : 'var(--bg-3)',
                        borderRadius: '4px 4px 0 0',
                        opacity: count > 0 ? 0.6 + (count / maxC) * 0.4 : 1,
                        transition: 'height 0.4s ease',
                        minWidth: 28,
                      }} />
                    </div>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>{day}</span>
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{count}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
