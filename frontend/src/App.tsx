import { useIsMobile } from './lib/useIsMobile'
import NotificationBanner, { type BannerNotification } from './components/NotificationBanner'
import { PUSH_EVENT } from './components/NotificationBell'
import UpdateToast from './components/UpdateToast'
import { useState, useEffect, useCallback, useRef } from 'react'
import TopBar, { type ThemeMode } from './components/TopBar'
import Sidebar from './components/Sidebar'
import BottomBar from './components/BottomBar'
import UserMenu from './components/UserMenu'
import ImportModal from './components/ImportModal'
import OfflineBar from './components/OfflineBar'
import PullToRefresh from './components/PullToRefresh'
import SwipePager from './components/SwipePager'
import { applyAccent, ACCENTS } from './lib/theme'
import Dashboard from './pages/Dashboard'
import Workouts from './pages/Workouts'
import WorkoutDetail from './pages/WorkoutDetail'
import Consistency from './pages/Consistency'
import Analysis from './pages/Analysis'
import Equipment from './pages/Equipment'
import Help from './pages/Help'
import Settings from './pages/Settings'
import Account from './pages/Account'
import Admin from './pages/Admin'
import Login from './pages/Login'
import { type Workout } from './data/workouts'
import { useAuth } from './context/AuthContext'
import { useRefresh } from './context/RefreshContext'
import { WorkoutsProvider } from './context/WorkoutsContext'
import { adjacentPage, DESKTOP_PAGES, LEGACY_ROUTES, type Page } from './lib/nav'
import { useSwipeNav } from './lib/useSwipeNav'
import { consumeShareParam, takeSharedFiles } from './lib/shareTarget'
import { applySystemBars } from './lib/native/systemBars'
import { onPushMessage } from './lib/native/unifiedPush'
import { api } from './lib/api'

const SIDEBAR_KEY = 'al_sidebar_w'
const THEME_KEY = 'al_theme'
const ACCENT_KEY = 'al_accent'
const PAGES: Page[] = [...DESKTOP_PAGES, 'settings', 'account', 'admin']

// URL <-> app state helpers. Routes are path-based (e.g. /workouts,
// /workouts/:id, /settings) so a full page reload lands back on the same
// page/workout instead of always resetting to the dashboard.
function pathForPage(p: Page): string {
  return p === 'dashboard' ? '/' : `/${p}`
}

function parseLocation(pathname = window.location.pathname): { page: Page; workoutId: string | null; redirect?: boolean } {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length === 0) return { page: 'dashboard', workoutId: null }
  if (segs[0] === 'workouts' && segs[1]) return { page: 'workouts', workoutId: segs[1] }
  const candidate = segs[0] as Page
  if (PAGES.includes(candidate)) return { page: candidate, workoutId: null }
  // Timeline was folded into Analysis and Heatmap became Consistency; keep old
  // links and open tabs working instead of dumping them on the dashboard.
  const legacy = LEGACY_ROUTES[segs[0]]
  if (legacy) return { page: legacy, workoutId: null, redirect: true }
  return { page: 'dashboard', workoutId: null }
}

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return mode
}

/** --bg in each theme, mirrored in mobile/android/.../values/colors.xml. */
const THEME_BACKGROUND = { light: '#f4f6f9', dark: '#0a0b0e' } as const

function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode)
  document.documentElement.className = resolved === 'light' ? 'light' : ''
  const background = THEME_BACKGROUND[resolved]
  // Keep the phone's status bar matching the page background instead of the
  // accent colour, in both themes. The meta tag does this for the installed
  // PWA; the Android app needs the same thing said to the Activity, because
  // there the bars are the window's rather than the page's.
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', background)
  applySystemBars(background, resolved === 'dark')
}

export default function App() {
  const { user, loading, logout } = useAuth()
  const initialLocation = useRef(parseLocation()).current
  const [page, setPage] = useState<Page>(initialLocation.page)
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  // A push that arrived while the app was on screen, shown as a banner.
  const [banner, setBanner] = useState<BannerNotification | null>(null)
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
  // Files handed to the app from outside: the Android share sheet, or a
  // desktop "Open with". Both land in the import modal the same way.
  const [incomingFiles, setIncomingFiles] = useState<File[] | null>(null)
  const isMobile = useIsMobile()

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

  // Rewrite retired routes (/timeline, /heatmap) to where they moved, so the
  // address bar matches the page and a reload doesn't redirect a second time.
  useEffect(() => {
    if (initialLocation.redirect) {
      window.history.replaceState(null, '', pathForPage(initialLocation.page))
    }
  }, [initialLocation])

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

  // Pick up a workout file shared into the installed app from the Android
  // share sheet. The service worker stashed it and redirected here with
  // ?share=; claim it and open the import modal ready to go. Waits for auth so
  // a share that arrives while logged out survives the login screen.
  useEffect(() => {
    if (!user) return
    if (consumeShareParam() === null) return
    let cancelled = false
    // The modal opens either way: if the handoff failed, an empty import modal
    // is a better outcome than the share appearing to do nothing.
    takeSharedFiles().then(files => {
      if (cancelled) return
      setIncomingFiles(files.length > 0 ? files : null)
      setShowImport(true)
    })
    return () => { cancelled = true }
  }, [user])

  // "Open with" on desktop. An installed PWA that declares file_handlers is
  // launched with the files in launchQueue; Chrome and Edge on desktop are the
  // only places this exists, so the whole block is feature-detected away
  // elsewhere. Android has no file association for PWAs — the share sheet above
  // is that platform's equivalent, and it already works.
  useEffect(() => {
    if (!user || !('launchQueue' in window)) return
    const queue = (window as { launchQueue?: LaunchQueue }).launchQueue
    queue?.setConsumer(async params => {
      if (!params.files?.length) return
      const files = await Promise.all(params.files.map(handle => handle.getFile()))
      if (files.length === 0) return
      setIncomingFiles(files)
      setShowImport(true)
    })
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

  /**
   * Opens an in-app path — a notification's deep link, or a navigation request
   * relayed by the service worker when a push is tapped. Parsed rather than
   * assigned to location.href so the SPA routes without a full reload.
   */
  const openLink = useCallback((link: string) => {
    const loc = parseLocation(new URL(link, window.location.origin).pathname)
    if (loc.workoutId) {
      api.getWorkout(loc.workoutId)
        .then(w => {
          setSelectedWorkout(w)
          window.history.pushState(null, '', `/workouts/${w.id}`)
        })
        // A workout that has since been unshared or deleted: land on the list
        // rather than a dead end.
        .catch(() => {
          setSelectedWorkout(null)
          setPage('workouts')
          window.history.pushState(null, '', pathForPage('workouts'))
        })
      return
    }
    setSelectedWorkout(null)
    setPage(loc.page)
    window.history.pushState(null, '', pathForPage(loc.page))
  }, [])

  // Two things arrive from the service worker: a tapped OS notification asking
  // us to route, and a push that landed while the app was visible, which it
  // suppressed in favour of the in-app banner.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; url?: string; payload?: BannerNotification } | undefined
      if (data?.type === 'NAVIGATE' && data.url) openLink(data.url)
      if (data?.type === 'IN_APP_NOTIFICATION' && data.payload) {
        setBanner(data.payload)
        // Tell the bell to refresh its count now rather than on its next poll.
        window.dispatchEvent(new Event(PUSH_EVENT))
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [openLink])

  // The same thing in the Android app, which has no service worker to route it.
  // The native receiver only hands a push over while this listener is attached;
  // otherwise it draws a notification, so unmounting cannot lose one.
  useEffect(() => onPushMessage(payload => {
    setBanner(payload)
    window.dispatchEvent(new Event(PUSH_EVENT))
  }), [])

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
        const map: Record<string, Page> = { d: 'dashboard', w: 'workouts', a: 'analysis', c: 'consistency', e: 'equipment' }
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

  // The <main> element, tracked as state via a callback ref rather than a
  // plain useRef. isMobile can already be true (and so gesturesEnabled true)
  // before <main> exists — the loading/login screens render a different tree
  // — and a useRef's identity never changes when .current is first attached,
  // so an effect keyed on the ref object would bind before the element exists
  // and then never notice it mount. Threading the element through state makes
  // that transition a real dependency change for useSwipeNav/PullToRefresh.
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null)
  const mainRef = useCallback((node: HTMLElement | null) => setMainEl(node), [])

  // Mobile swipe navigation across the bottom-bar pages. Disabled while a
  // workout detail is open, where horizontal drags belong to the map.
  const swipeTo = useCallback((steps: number) => {
    const next = adjacentPage(page, steps)
    if (next) navigate(next)
  }, [page, navigate])
  const gesturesEnabled = isMobile && !selectedWorkout && !showImport && !showUserMenu
  const onPrev = useCallback(() => swipeTo(-1), [swipeTo])
  const onNext = useCallback(() => swipeTo(1), [swipeTo])
  const swipe = useSwipeNav(mainEl, { enabled: gesturesEnabled, onPrev, onNext })

  // Pull-to-refresh reloads the data each page registered, never the document.
  const { refresh } = useRefresh()

  // Start each page at the top. Without this a swipe from a scrolled page
  // animates the next one in already scrolled down, which reads as a glitch.
  useEffect(() => {
    mainEl?.scrollTo({ top: 0 })
  }, [page, mainEl])

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
    // The offline bar comes along: landing here because the backend is
    // unreachable, with no explanation, is what made this confusing.
    return (
      <>
        <OfflineBar floating />
        <Login />
      </>
    )
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
        onHome={() => navigate('dashboard')}
        onNavigate={openLink}
        isMobile={isMobile}
        user={user}
      />

      {banner && (
        <NotificationBanner
          notification={banner}
          onOpen={link => { setBanner(null); openLink(link) }}
          onDismiss={() => setBanner(null)}
        />
      )}

      <UpdateToast />

      <OfflineBar />

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

      <main className="main-content" ref={mainRef}>
        <PullToRefresh scrollEl={mainEl} enabled={gesturesEnabled} onRefresh={refresh} />
        <SwipePager page={page} swipe={swipe}>
        {selectedWorkout ? (
          <WorkoutDetail key={selectedWorkout.id} workout={selectedWorkout} accent={accent} onBack={() => selectWorkout(null)} />
        ) : page === 'dashboard' ? (
          <Dashboard />
        ) : page === 'workouts' ? (
          <Workouts onSelect={selectWorkout} onImport={() => setShowImport(true)} />
        ) : page === 'analysis' ? (
          <Analysis />
        ) : page === 'consistency' ? (
          <Consistency />
        ) : page === 'equipment' ? (
          <Equipment onSelectWorkout={id => { api.getWorkout(id).then(selectWorkout).catch(() => {}) }} />
        ) : page === 'settings' ? (
          <Settings accent={accent} onAccentChange={setAccent} />
        ) : page === 'account' ? (
          <Account />
        ) : page === 'admin' ? (
          <Admin />
        ) : (
          <Help />
        )}
        </SwipePager>
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
          initialFiles={incomingFiles}
          onClose={() => { setShowImport(false); setIncomingFiles(null) }}
          onViewWorkout={w => { selectWorkout(w); setShowImport(false); setIncomingFiles(null) }}
        />
      )}
      </div>
    </WorkoutsProvider>
  )
}
