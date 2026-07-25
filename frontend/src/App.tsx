import { useState, useEffect, useCallback, useRef } from 'react'
import TopBar, { type ThemeMode } from './components/TopBar'
import Sidebar from './components/Sidebar'
import BottomBar from './components/BottomBar'
import UserMenu from './components/UserMenu'
import ImportModal from './components/ImportModal'
import { applyAccent, ACCENTS } from './lib/theme'
import Dashboard from './pages/Dashboard'
import Workouts from './pages/Workouts'
import WorkoutDetail from './pages/WorkoutDetail'
import Heatmap from './pages/Heatmap'
import Timeline from './pages/Timeline'
import Analysis from './pages/Analysis'
import Help from './pages/Help'
import Settings from './pages/Settings'
import Account from './pages/Account'
import Admin from './pages/Admin'
import Login from './pages/Login'
import { type Workout } from './data/workouts'
import { useAuth } from './context/AuthContext'
import { WorkoutsProvider } from './context/WorkoutsContext'
import { type Page } from './lib/nav'
import { api } from './lib/api'

const SIDEBAR_KEY = 'al_sidebar_w'
const THEME_KEY = 'al_theme'
const ACCENT_KEY = 'al_accent'
const PAGES: Page[] = ['dashboard', 'workouts', 'heatmap', 'timeline', 'analysis', 'help', 'settings', 'account', 'admin']

// URL <-> app state helpers. Routes are path-based (e.g. /workouts,
// /workouts/:id, /settings) so a full page reload lands back on the same
// page/workout instead of always resetting to the dashboard.
function pathForPage(p: Page): string {
  return p === 'dashboard' ? '/' : `/${p}`
}

function parseLocation(): { page: Page; workoutId: string | null } {
  const segs = window.location.pathname.split('/').filter(Boolean)
  if (segs.length === 0) return { page: 'dashboard', workoutId: null }
  if (segs[0] === 'workouts' && segs[1]) return { page: 'workouts', workoutId: segs[1] }
  const candidate = segs[0] as Page
  if (PAGES.includes(candidate)) return { page: candidate, workoutId: null }
  return { page: 'dashboard', workoutId: null }
}

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return mode
}

function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode)
  document.documentElement.className = resolved === 'light' ? 'light' : ''
}

export default function App() {
  const { user, loading, logout } = useAuth()
  const initialLocation = useRef(parseLocation()).current
  const [page, setPage] = useState<Page>(initialLocation.page)
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(SIDEBAR_KEY)
    return saved ? parseInt(saved) : 240
  })
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem(THEME_KEY) as ThemeMode) || 'dark'
  })
  const [accent, setAccent] = useState(() => {
    return localStorage.getItem(ACCENT_KEY) || ACCENTS[0].value
  })
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [isMobile, setIsMobile] = useState(false)

  // Detect mobile
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 769)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  // Theme
  useEffect(() => {
    applyTheme(themeMode)
    localStorage.setItem(THEME_KEY, themeMode)

    if (themeMode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const handler = () => applyTheme('system')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [themeMode])

  // Accent
  useEffect(() => {
    applyAccent(accent)
    localStorage.setItem(ACCENT_KEY, accent)
  }, [accent])

  // Sidebar width CSS var
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, sidebarWidth.toString())
    document.documentElement.style.setProperty('--sidebar-w', `${sidebarWidth}px`)
  }, [sidebarWidth])

  // Resolve a deep-linked workout on first load (e.g. reloading /workouts/abc).
  useEffect(() => {
    if (!initialLocation.workoutId || !user) return
    let cancelled = false
    api.getWorkout(initialLocation.workoutId)
      .then(w => { if (!cancelled) setSelectedWorkout(w) })
      .catch(() => { if (!cancelled) window.history.replaceState(null, '', pathForPage('workouts')) })
    return () => { cancelled = true }
    // Only run once, when auth resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Keep app state in sync with browser back/forward navigation.
  useEffect(() => {
    function onPopState() {
      const loc = parseLocation()
      setPage(loc.page)
      if (loc.workoutId) {
        api.getWorkout(loc.workoutId).then(setSelectedWorkout).catch(() => setSelectedWorkout(null))
      } else {
        setSelectedWorkout(null)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((p: Page) => {
    setPage(p)
    setSelectedWorkout(null)
    window.history.pushState(null, '', pathForPage(p))
  }, [])

  const selectWorkout = useCallback((w: Workout | null) => {
    setSelectedWorkout(w)
    window.history.pushState(null, '', w ? `/workouts/${w.id}` : pathForPage('workouts'))
  }, [])

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed(c => !c)
  }, [])

  const cycleTheme = useCallback(() => {
    setThemeMode(m => m === 'dark' ? 'light' : m === 'light' ? 'system' : 'dark')
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    let gPressed = false
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return
      if (gPressed) {
        gPressed = false
        const map: Record<string, Page> = { d: 'dashboard', w: 'workouts', h: 'heatmap', t: 'timeline', a: 'analysis' }
        if (map[e.key]) { navigate(map[e.key]); return }
      }
      if (e.key === 'g') { gPressed = true; setTimeout(() => { gPressed = false }, 1000); return }
      if (e.key === '[') toggleSidebar()
      if (e.key === 'Escape') {
        selectWorkout(null)
        setShowUserMenu(false)
        setShowImport(false)
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'i') {
        e.preventDefault()
        setShowImport(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, toggleSidebar, selectWorkout])

  const layoutClass = [
    'app-layout',
    sidebarCollapsed && !isMobile ? 'collapsed' : '',
  ].filter(Boolean).join(' ')

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', color: 'var(--text-3)', fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  if (!user) {
    return <Login />
  }

  return (
    <WorkoutsProvider>
      <div className={layoutClass}>
      <TopBar
        onToggleSidebar={toggleSidebar}
        themeMode={themeMode}
        onCycleTheme={cycleTheme}
        onUserMenu={() => setShowUserMenu(v => !v)}
        onHelp={() => navigate('help')}
        isMobile={isMobile}
        user={user}
      />

      {/* Desktop sidebar — hidden on mobile via CSS */}
      <Sidebar
        currentPage={page}
        onNavigate={navigate}
        collapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
        onWidthChange={w => setSidebarWidth(w)}
        onImport={() => setShowImport(true)}
        isMobile={isMobile}
      />

      <main className="main-content">
        {selectedWorkout ? (
          <WorkoutDetail key={selectedWorkout.id} workout={selectedWorkout} accent={accent} onBack={() => selectWorkout(null)} />
        ) : page === 'dashboard' ? (
          <Dashboard />
        ) : page === 'workouts' ? (
          <Workouts onSelect={selectWorkout} onImport={() => setShowImport(true)} />
        ) : page === 'heatmap' ? (
          <Heatmap />
        ) : page === 'timeline' ? (
          <Timeline />
        ) : page === 'analysis' ? (
          <Analysis />
        ) : page === 'settings' ? (
          <Settings accent={accent} onAccentChange={setAccent} />
        ) : page === 'account' ? (
          <Account />
        ) : page === 'admin' ? (
          <Admin />
        ) : (
          <Help />
        )}
      </main>

      {/* Mobile bottom bar */}
      {isMobile && (
        <BottomBar currentPage={page} onNavigate={navigate} />
      )}

      {/* Overlays */}
      {showUserMenu && (
        <UserMenu
          onClose={() => setShowUserMenu(false)}
          onAccount={() => navigate('account')}
          onSettings={() => navigate('settings')}
          onAdmin={() => navigate('admin')}
          onLogout={logout}
          user={user}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onViewWorkout={w => { selectWorkout(w); setShowImport(false) }}
        />
      )}
      </div>
    </WorkoutsProvider>
  )
}
