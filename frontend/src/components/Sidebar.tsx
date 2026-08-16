import { useRef, useCallback } from 'react'
import { LayoutDashboard, Dumbbell, CalendarCheck, BarChart2, HelpCircle, Map as MapIcon, Plus, Watch, Tag, Compass, ClipboardList } from 'lucide-react'
import { DESKTOP_PAGES, type Page } from '../lib/nav'

interface SidebarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
  collapsed: boolean
  sidebarWidth: number
  onWidthChange: (w: number) => void
  onImport: () => void
  isMobile: boolean
}

// Presentation only — DESKTOP_PAGES fixes the order, so the sidebar and the
// mobile bottom bar can never drift apart.
export const PAGE_META: Partial<Record<Page, { label: string; icon: (size: number) => React.ReactNode }>> = {
  dashboard: { label: 'Dashboard', icon: s => <LayoutDashboard size={s} /> },
  workouts: { label: 'Workouts', icon: s => <Dumbbell size={s} /> },
  analysis: { label: 'Analysis', icon: s => <BarChart2 size={s} /> },
  consistency: { label: 'Consistency', icon: s => <CalendarCheck size={s} /> },
  map: { label: 'Map', icon: s => <MapIcon size={s} /> },
  equipment: { label: 'Equipment', icon: s => <Watch size={s} /> },
  discover: { label: 'Discover', icon: s => <Compass size={s} /> },
  plans: { label: 'Plans', icon: s => <ClipboardList size={s} /> },
  help: { label: 'Help', icon: s => <HelpCircle size={s} /> },
}

const navItems = DESKTOP_PAGES.flatMap(id => {
  const meta = PAGE_META[id]
  return meta ? [{ id, label: meta.label, icon: meta.icon(18) }] : []
})

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
            // A step under the nav items below it: it is the one button here,
            // and matching their size made two different kinds of thing read as
            // one list.
            fontSize: 14,
          }}
          title="Add Workout"
        >
          <Plus size={16} strokeWidth={2.5} />
          {!collapsed && <span>Add Workout</span>}
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
                fontSize: 15,
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
            <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)' }}>
              <Tag size={11} aria-hidden />
              Version: {__APP_VERSION__}
            </span>
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
