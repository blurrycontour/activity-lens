import { useRef, useCallback } from 'react'
import { LayoutDashboard, Dumbbell, MapIcon, BarChart2, Activity, HelpCircle, Upload } from 'lucide-react'

type Page = 'dashboard' | 'workouts' | 'heatmap' | 'timeline' | 'analysis' | 'help'

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  collapsed: boolean
  sidebarWidth: number
  onWidthChange: (w: number) => void
  onImport: () => void
  isMobile: boolean
}

const navItems: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'workouts', label: 'Workouts', icon: <Dumbbell size={18} /> },
  { id: 'heatmap', label: 'Heatmap', icon: <MapIcon size={18} /> },
  { id: 'timeline', label: 'Timeline', icon: <Activity size={18} /> },
  { id: 'analysis', label: 'Analysis', icon: <BarChart2 size={18} /> },
  { id: 'help', label: 'Help', icon: <HelpCircle size={18} /> },
]

export default function Sidebar({ currentPage, onNavigate, collapsed, sidebarWidth, onWidthChange, onImport, isMobile }: SidebarProps) {
  const dragRef = useRef(false)
  const startXRef = useRef(0)
  const startWRef = useRef(0)
  const handleRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (collapsed) return
    dragRef.current = true
    startXRef.current = e.clientX
    startWRef.current = sidebarWidth
    if (handleRef.current) handleRef.current.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    function onMouseMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const delta = ev.clientX - startXRef.current
      const newW = Math.max(180, Math.min(360, startWRef.current + delta))
      onWidthChange(newW)
    }
    function onMouseUp() {
      dragRef.current = false
      if (handleRef.current) handleRef.current.classList.remove('dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [collapsed, sidebarWidth, onWidthChange])

  const effectiveWidth = collapsed ? 56 : sidebarWidth

  return (
    <aside
      className="sidebar"
      style={{ width: isMobile ? undefined : effectiveWidth, transition: collapsed ? 'width 0.2s ease' : undefined }}
    >
      <div style={{ padding: collapsed ? '12px 8px' : '12px', borderBottom: '1px solid var(--border)' }}>
        <button
          className="btn btn-primary"
          onClick={onImport}
          style={{
            width: '100%',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? '7px' : '7px 12px',
          }}
          title="Import Workout"
        >
          <Upload size={15} />
          {!collapsed && <span>Import Workout</span>}
        </button>
      </div>

      <nav style={{ flex: 1, padding: '8px', overflowY: 'auto' }}>
        {navItems.map(item => {
          const active = currentPage === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              title={collapsed ? item.label : undefined}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: collapsed ? '9px' : '9px 12px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                background: active ? 'var(--primary-dim)' : 'transparent',
                color: active ? 'var(--primary)' : 'var(--text-2)',
                fontWeight: active ? 600 : 400,
                fontSize: 13,
                textAlign: 'left',
                transition: 'all 0.12s',
                justifyContent: collapsed ? 'center' : 'flex-start',
                position: 'relative',
                marginBottom: 2,
              }}
              onMouseEnter={e => {
                if (!active) e.currentTarget.style.background = 'var(--bg-3)'
                if (!active) e.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={e => {
                if (!active) e.currentTarget.style.background = 'transparent'
                if (!active) e.currentTarget.style.color = 'var(--text-2)'
              }}
            >
              {active && (
                <span style={{
                  position: 'absolute', left: 0, top: '20%', bottom: '20%',
                  width: 3, background: 'var(--primary)', borderRadius: '0 3px 3px 0',
                }} />
              )}
              <span style={{ flexShrink: 0 }}>{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {!isMobile && !collapsed && (
        <div style={{ padding: '12px', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--primary)',
              boxShadow: '0 0 6px var(--primary)',
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            <span style={{ fontSize: 11, color: 'var(--text-3)' }}>GPS sync active</span>
          </div>
        </div>
      )}

      {!isMobile && (
        <div
          ref={handleRef}
          className="sidebar-resize"
          onMouseDown={onMouseDown}
          style={{ display: collapsed ? 'none' : undefined }}
        />
      )}
    </aside>
  )
}
