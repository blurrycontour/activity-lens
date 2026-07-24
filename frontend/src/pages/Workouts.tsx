import { useState, useMemo } from 'react'
import { fmtDuration, fmtDist, fmtPace, TYPE_COLOR, TYPE_ICON, type WorkoutType, type Workout } from '../data/workouts'
import { useWorkouts } from '../context/WorkoutsContext'
import { Search, ChevronRight, Clock, Mountain, Flame, Download, Plus } from 'lucide-react'
import TypeDropdown from '../components/TypeDropdown'

interface WorkoutsProps {
  onSelect: (w: Workout) => void
  onImport: () => void
}

export default function Workouts({ onSelect, onImport }: WorkoutsProps) {
  const { workouts, loading } = useWorkouts()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'All'>('All')
  const [sortBy, setSortBy] = useState<'date' | 'distance' | 'duration'>('date')
  const [dateRange, setDateRange] = useState<'all' | '7d' | '30d' | '90d'>('all')

  const filtered = useMemo(() => {
    let result = [...workouts]
    if (typeFilter !== 'All') result = result.filter(w => w.type === typeFilter)
    if (search) result = result.filter(w => w.name.toLowerCase().includes(search.toLowerCase()))
    if (dateRange !== 'all') {
      const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)
      result = result.filter(w => new Date(w.date) >= cutoff)
    }
    result.sort((a, b) => {
      if (sortBy === 'date') return new Date(b.date).getTime() - new Date(a.date).getTime()
      if (sortBy === 'distance') return b.distance - a.distance
      return b.duration - a.duration
    })
    return result
  }, [workouts, search, typeFilter, sortBy, dateRange])

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Workouts</h1>
          <span style={{ fontSize: 12, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>{filtered.length} of {workouts.length}</span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 180 }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)', pointerEvents: 'none' }} />
            <input
              className="input"
              placeholder="Search workouts..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ paddingLeft: 30, width: '100%' }}
            />
          </div>

          {/* Type filter dropdown */}
          <TypeDropdown value={typeFilter} onChange={v => setTypeFilter(v)} />

          {/* Sort */}
          <select className="select" value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
            <option value="date">By Date</option>
            <option value="distance">By Distance</option>
            <option value="duration">By Duration</option>
          </select>

          {/* Date range */}
          <select className="select" value={dateRange} onChange={e => setDateRange(e.target.value as typeof dateRange)}>
            <option value="all">All time</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
          </select>
        </div>
      </div>

      <div className="page-content" style={{ padding: '16px 24px' }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-3)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>{loading ? '⏳' : '🔍'}</div>
            <p style={{ fontSize: 14 }}>{loading ? 'Loading workouts…' : 'No workouts found'}</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(w => <WorkoutCard key={w.id} workout={w} onClick={() => onSelect(w)} />)}
          </div>
        )}
      </div>

      {/* Floating + button */}
      <button
        className="fab"
        onClick={onImport}
        title="Import / Add Workout"
        aria-label="Add workout"
      >
        <Plus size={24} strokeWidth={2.5} />
      </button>
    </div>
  )
}

function exportWorkout(w: Workout, e: React.MouseEvent) {
  e.stopPropagation()
  // Build a minimal GPX string
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Activity Lens">
  <trk>
    <name>${w.name}</name>
    <type>${w.type}</type>
    <trkseg>
${w.route.map(([lat, lng]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`
  const blob = new Blob([gpx], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${w.name.replace(/\s+/g, '_')}_${w.date}.gpx`
  a.click()
  URL.revokeObjectURL(url)
}

function WorkoutCard({ workout: w, onClick }: { workout: Workout; onClick: () => void }) {
  const color = TYPE_COLOR[w.type]

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-2)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '14px 16px',
        display: 'grid',
        gridTemplateColumns: '44px 1fr auto',
        alignItems: 'center',
        gap: 14,
        cursor: 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
        overflow: 'hidden',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `${color}40`
        e.currentTarget.style.background = 'var(--bg-3)'
        e.currentTarget.style.transform = 'translateX(2px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--bg-2)'
        e.currentTarget.style.transform = 'translateX(0)'
      }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: color, borderRadius: '3px 0 0 3px' }} />

      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        background: `${color}18`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
      }}>
        {TYPE_ICON[w.type]}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
          <span className={`badge tag-${w.type.toLowerCase()}`}>{w.type}</span>
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
            {new Date(w.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
          {w.distance > 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>
              {fmtDist(w.distance)}
            </span>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Clock size={11} color="var(--text-3)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{fmtDuration(w.duration)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Mountain size={11} color="var(--text-3)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>+{w.elevationGain}m</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            <Flame size={11} color="var(--text-3)" />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)' }}>{w.calories} kcal</span>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color }}>
            {w.avgPace ? fmtPace(w.avgPace) : `${w.avgSpeed.toFixed(1)}`}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-3)' }}>
            {w.avgPace ? '/km' : 'km/h'}
          </div>
        </div>
        <button
          className="btn-icon"
          title="Export as GPX"
          onClick={e => exportWorkout(w, e)}
          style={{ opacity: 0.6 }}
          onMouseEnter={e => e.currentTarget.style.opacity = '1'}
          onMouseLeave={e => e.currentTarget.style.opacity = '0.6'}
        >
          <Download size={15} />
        </button>
        <ChevronRight size={16} color="var(--text-3)" />
      </div>
    </div>
  )
}
