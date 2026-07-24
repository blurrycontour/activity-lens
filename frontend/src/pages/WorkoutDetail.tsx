import { type Workout, fmtDuration, fmtDist, fmtPace, TYPE_COLOR, TYPE_ICON } from '../data/workouts'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { ArrowLeft, Heart, Mountain, Zap, Clock, TrendingUp, Navigation, Download } from 'lucide-react'

function exportGPX(w: Workout) {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Activity Lens">
  <metadata><name>${w.name}</name></metadata>
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

interface WorkoutDetailProps {
  workout: Workout
  onBack: () => void
}

function RouteMap({ route, color }: { route: Array<[number, number]>; color: string }) {
  if (route.length < 2) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: 13 }}>
        No route data
      </div>
    )
  }
  const lats = route.map(p => p[0])
  const lngs = route.map(p => p[1])
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const pad = 0.1
  const W = 400, H = 250

  function toSvg(lat: number, lng: number): [number, number] {
    const x = ((lng - minLng) / ((maxLng - minLng) || 1)) * (W * (1 - pad * 2)) + W * pad
    const y = H - (((lat - minLat) / ((maxLat - minLat) || 1)) * (H * (1 - pad * 2)) + H * pad)
    return [x, y]
  }

  const points = route.map(p => toSvg(p[0], p[1]))
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const [sx, sy] = points[0]
  const [ex, ey] = points[points.length - 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: '100%' }}>
      <defs>
        <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      {/* Shadow path */}
      <path d={pathD} fill="none" stroke={color} strokeWidth="6" strokeOpacity="0.12" strokeLinecap="round" strokeLinejoin="round" />
      {/* Main path */}
      <path d={pathD} fill="none" stroke="url(#routeGrad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" filter="url(#glow)" />
      {/* Start marker */}
      <circle cx={sx} cy={sy} r="5" fill="var(--bg-2)" stroke={color} strokeWidth="2" />
      <circle cx={sx} cy={sy} r="2.5" fill={color} />
      {/* End marker */}
      <circle cx={ex} cy={ey} r="6" fill={color} stroke="var(--bg-2)" strokeWidth="2" />
      <circle cx={ex} cy={ey} r="3" fill="var(--bg-2)" />
    </svg>
  )
}

function ChartTooltip({ active, payload, label, unit }: { active?: boolean; payload?: any[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null
  const mins = Math.floor(Number(label) / 60)
  return (
    <div className="custom-tooltip">
      <div style={{ color: 'var(--text-3)', marginBottom: 2 }}>{mins}m</div>
      <div style={{ color: 'var(--text)', fontWeight: 600 }}>{payload[0].value} {unit}</div>
    </div>
  )
}

export default function WorkoutDetail({ workout: w, onBack }: WorkoutDetailProps) {
  const color = TYPE_COLOR[w.type]

  const stats = [
    { icon: <Navigation size={14} />, label: 'Distance', value: fmtDist(w.distance) },
    { icon: <Clock size={14} />, label: 'Duration', value: fmtDuration(w.duration) },
    { icon: <Heart size={14} />, label: 'Avg HR', value: `${w.avgHR} bpm` },
    { icon: <Heart size={14} />, label: 'Max HR', value: `${w.maxHR} bpm` },
    { icon: <Mountain size={14} />, label: 'Elevation', value: `${w.elevationGain} m` },
    { icon: <Zap size={14} />, label: 'Calories', value: `${w.calories} kcal` },
    { icon: <TrendingUp size={14} />, label: w.avgPace ? 'Avg Pace' : 'Avg Speed', value: w.avgPace ? fmtPace(w.avgPace) + ' /km' : `${w.avgSpeed.toFixed(1)} km/h` },
    { icon: <TrendingUp size={14} />, label: 'Max Speed', value: `${(w.avgSpeed * 1.18).toFixed(1)} km/h` },
  ]

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn-icon" onClick={onBack}><ArrowLeft size={18} /></button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>{w.name}</h1>
              <span className={`badge tag-${w.type.toLowerCase()}`}>{TYPE_ICON[w.type]} {w.type}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {new Date(w.date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => exportGPX(w)}
            style={{ marginLeft: 'auto', flexShrink: 0, gap: 6 }}
            title="Export as GPX"
          >
            <Download size={14} /> Export GPX
          </button>
        </div>
      </div>

      <div className="page-content">
        {/* Map + stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 16, marginBottom: 16 }}>
          <div className="card" style={{ height: 280, padding: 0, overflow: 'hidden', position: 'relative', background: 'var(--bg-3)' }}>
            <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(ellipse at 50% 50%, ${color}08 0%, transparent 70%)` }} />
            <RouteMap route={w.route} color={color} />
            <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 8 }}>
              <div style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-3)' }}>
                ● Start
              </div>
              <div style={{ background: color, borderRadius: 6, padding: '4px 8px', fontSize: 11, fontFamily: 'var(--font-mono)', color: '#0a0b0e', fontWeight: 600 }}>
                ■ Finish
              </div>
            </div>
          </div>

          <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {stats.slice(0, 6).map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ color: 'var(--text-3)' }}>{s.icon}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{s.label}</span>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Charts */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {/* Heart Rate chart */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Heart size={14} color="#ef4444" /> Heart Rate</h3>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>Avg {w.avgHR} · Max {w.maxHR}</span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={w.hrTimeline} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="hrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={v => `${Math.floor(v / 60)}m`} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip unit="bpm" />} />
                <Area type="monotone" dataKey="hr" stroke="#ef4444" strokeWidth={2} fill="url(#hrGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Pace chart */}
          {w.paceTimeline.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h3 style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><TrendingUp size={14} color={color} /> Pace</h3>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>Avg {fmtPace(w.avgPace)} /km</span>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <AreaChart data={w.paceTimeline} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="paceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={v => `${Math.floor(v / 60)}m`} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} reversed tickFormatter={v => fmtPace(v)} />
                  <Tooltip content={<ChartTooltip unit="s/km" />} />
                  <Area type="monotone" dataKey="pace" stroke={color} strokeWidth={2} fill="url(#paceGrad)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Elevation chart */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><Mountain size={14} color="var(--hike)" /> Elevation</h3>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-3)' }}>+{w.elevationGain} m gain</span>
            </div>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={w.elevTimeline} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <defs>
                  <linearGradient id="elevGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--hike)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--hike)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 4" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} tickFormatter={v => `${Math.floor(v / 60)}m`} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)', fontFamily: 'var(--font-mono)' }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip unit="m" />} />
                <Area type="monotone" dataKey="elev" stroke="var(--hike)" strokeWidth={2} fill="url(#elevGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {w.notes && (
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Notes</h3>
            <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6 }}>{w.notes}</p>
          </div>
        )}
      </div>
    </div>
  )
}
