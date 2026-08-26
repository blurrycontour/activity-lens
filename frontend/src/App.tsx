import { useIsMobile } from './lib/useIsMobile'
import { lazyChunk } from './lib/lazyChunk'
import NotificationBanner, { type BannerNotification } from './components/NotificationBanner'
import { consumeOpenedParam, markNotificationOpened, PUSH_EVENT, READ_NOTIFICATION_EVENT } from './lib/notifications'
import UpdateToast from './components/UpdateToast'
import Toast from './components/Toast'
import { useState, useEffect, useLayoutEffect, useCallback, useRef, lazy, Suspense } from 'react'
import TopBar, { type ThemeMode } from './components/TopBar'
import Sidebar from './components/Sidebar'
import BottomBar from './components/BottomBar'
import UserMenu from './components/UserMenu'
import ImportModal from './components/ImportModal'
import ImportIntro, { hasSeenImportIntro, markImportIntroSeen } from './components/ImportIntro'
import OfflineBar from './components/OfflineBar'
import PullToRefresh from './components/PullToRefresh'
import SwipePager from './components/SwipePager'
import {
  applyAccent, applyDisplayPrefs, backgroundFor, readDisplayPrefs,
  ACCENTS, HIGH_CONTRAST_KEY, PURE_BLACK_KEY, type DisplayPrefs,
} from './lib/theme'
import Dashboard from './pages/Dashboard'
import Workouts from './pages/Workouts'
import WorkoutDetail from './pages/WorkoutDetail'
import Consistency from './pages/Consistency'
import Analysis from './pages/Analysis'
import Equipment from './pages/Equipment'
import UserProfile from './pages/UserProfile'
import Discover from './pages/Discover'
import Help from './pages/Help'
/*
 * Lazily, because it is the only page that needs MapLibre and MapLibre is a
 * megabyte of JavaScript. Imported statically it sat in the entry chunk, so
 * every session parsed the map engine on first paint whether or not a map was
 * ever opened — and it made WorkoutDetail's lazy import of RouteMap pointless,
 * since the library was already loaded by then.
 */
const MapPage = lazy(lazyChunk(() => import('./pages/MapPage')))
// Lazy for the same reason: the editor and the runner are a page most sessions
// never open, and they are only ever reached by navigating to them.
const PlansPage = lazy(lazyChunk(() => import('./pages/plans/PlansPage')))
import Settings from './pages/settings'
import Admin from './pages/admin'
import Login from './pages/Login'
import { type Workout } from './data/workouts'
import { useAuth } from './context/AuthContext'
import { useRefresh } from './context/RefreshContext'
import { WorkoutsProvider } from './context/WorkoutsContext'
import { PreferencesProvider } from './context/PreferencesContext'
import { ActiveSessionProvider } from './context/ActiveSessionContext'
import {
  adjacentPage, navHighlight, parseLocation, pathForPage,
  type AdminSection, type Page, type SettingsSection,
} from './lib/nav'
import { useSwipeNav } from './lib/useSwipeNav'
import { consumeShareParam, takeSharedFiles } from './lib/shareTarget'
import { onNativeIncomingFiles, takeNativeIncomingFiles } from './lib/native/incomingFiles'
import { applySystemBars } from './lib/native/systemBars'
import {
  consumeNotificationTap, onNotificationTap, onPushMessage, type NotificationTap,
} from './lib/native/unifiedPush'
import { startUpdate } from './lib/appUpdate'
import { loadAboutInfo } from './lib/buildInfo'
import { LoaderCircle } from 'lucide-react'
import { api } from './lib/api'

/**
 * The link an update notification carries. Handled rather than navigated to:
 * see openLink. Kept in step with AppUpdateLink in the backend.
 */
const UPDATE_LINK = '/update'

/** Fired when openLink changes the URL without unmounting the page it lands on. */
export const LOCATION_EVENT = 'al:location'

const SIDEBAR_KEY = 'al_sidebar_w'
const THEME_KEY = 'al_theme'
const ACCENT_KEY = 'al_accent'

function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return mode
}

function applyTheme(mode: ThemeMode, prefs = readDisplayPrefs()) {
  const resolved = resolveTheme(mode)
  document.documentElement.className = resolved === 'light' ? 'light' : ''
  // Before the background is read, since pure black changes what it is.
  applyDisplayPrefs(prefs)
  const background = backgroundFor(resolved, prefs.pureBlack)
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
  // The open category within a hub page (settings, admin), or null for the hub.
  const [section, setSection] = useState<string | null>(initialLocation.section)
  // The record open inside that category, e.g. the account under Admin > Users.
  const [detail, setDetail] = useState<string | null>(initialLocation.detail)
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  /**
   * True while a workout named in the URL is still being fetched.
   *
   * Reloading /workouts/abc used to show the workout *list* for as long as the
   * request took, then swap it for the workout — a page you did not ask for,
   * arriving first and leaving. The deep link is known synchronously from the
   * path; only the data is late. This is what lets the app say "the workout is
   * coming" instead of guessing wrong in the meantime.
   */
  const [openingWorkout, setOpeningWorkout] = useState(Boolean(initialLocation.workoutId))
  /**
   * The last workout that was open, kept so the back gesture can put it back on
   * screen at once rather than through a round trip. A ref and not state: it
   * exists to be read inside the popstate listener, which is bound once.
   */
  const lastWorkout = useRef<Workout | null>(null)
  if (selectedWorkout) lastWorkout.current = selectedWorkout
  // A push that arrived while the app was on screen, shown as a banner.
  const [banner, setBanner] = useState<BannerNotification | null>(null)
  /**
   * Said when a deep-linked workout does not come back.
   *
   * Landing on the library is the right recovery — better than a dead end — but
   * done silently it reads as the link having gone to the wrong page. The three
   * places that can fail (a cold open, the back gesture, a notification tap)
   * all end up here so they answer the same way.
   */
  const [missingWorkout, setMissingWorkout] = useState(false)
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
  const [display, setDisplay] = useState<DisplayPrefs>(readDisplayPrefs)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showImportIntro, setShowImportIntro] = useState(false)
  // Files handed to the app from outside: the Android share sheet, or a
  // desktop "Open with". Both land in the import modal the same way.
  const [incomingFiles, setIncomingFiles] = useState<File[] | null>(null)
  const isMobile = useIsMobile()

  // Theme
  useEffect(() => {
    applyTheme(themeMode, display)
    localStorage.setItem(THEME_KEY, themeMode)
    localStorage.setItem(PURE_BLACK_KEY, display.pureBlack ? '1' : '0')
    localStorage.setItem(HIGH_CONTRAST_KEY, display.highContrast ? '1' : '0')

    if (themeMode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: light)')
      const handler = () => applyTheme('system', display)
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    }
  }, [themeMode, display])

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

  // Rewrite retired routes (/timeline, /heatmap, /account) to where they moved,
  // and unrecognised ones to the dashboard they fall back to, so the address bar
  // matches the page and a reload doesn't redirect twice.
  useEffect(() => {
    if (initialLocation.redirect) {
      window.history.replaceState(null, '', pathForPage(initialLocation.page, initialLocation.section, initialLocation.detail))
    }
  }, [initialLocation])

  // Resolve a deep-linked workout on first load (e.g. reloading /workouts/abc).
  useEffect(() => {
    if (!initialLocation.workoutId || !user) return
    let cancelled = false
    api.getWorkout(initialLocation.workoutId)
      .then(w => { if (!cancelled) setSelectedWorkout(w) })
      // Deleted, or no longer shared with you: fall back to the list rather
      // than leaving a spinner on screen for a workout that is not coming.
      .catch(() => {
        if (cancelled) return
        window.history.replaceState(null, '', pathForPage('workouts'))
        setMissingWorkout(true)
      })
      .finally(() => { if (!cancelled) setOpeningWorkout(false) })
    return () => { cancelled = true }
    // Only run once, when auth resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Warmed in the background, so the About dialog opens at its final size
  // rather than growing as two requests land. Nothing here changes while the
  // app runs, and it is a few hundred bytes.
  useEffect(() => {
    if (!user) return
    void loadAboutInfo()
  }, [user])

  /*
   * Fetch the map's code once the app is idle, so the Map page opens without a
   * wait even though it is not in the startup bundle.
   *
   * MapLibre is about a megabyte, and most sessions never open a map — loading
   * it eagerly put that on the critical path for everyone, including the phone
   * app, which starts cold every launch. Loading it only on demand moved the
   * cost to a spinner the first time you visit the page. Doing it here costs
   * neither: first paint is already done, and by the time anyone reaches the
   * page the chunk is in memory.
   *
   * Skipped when the browser says the connection is metered — spending a
   * megabyte on a page that may never be opened is exactly what that flag is
   * asking us not to do. Those sessions fall back to loading it on demand.
   *
   * The specifier must match the lazy import above verbatim, or Vite treats it
   * as a second module and this warms nothing.
   */
  useEffect(() => {
    if (!user) return
    if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return
    const warm = () => { void import('./pages/MapPage') }
    // requestIdleCallback is still missing on Safari; a timeout is a fine
    // stand-in, since the only requirement is "not during startup".
    const idle = typeof window.requestIdleCallback === 'function'
    const id = idle ? window.requestIdleCallback(warm, { timeout: 5000 }) : window.setTimeout(warm, 3000)
    return () => { if (idle) window.cancelIdleCallback(id); else window.clearTimeout(id) }
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

  // The same thing in the Android app, which gets there by a different road.
  //
  // There is no service worker in the loop and no ?share= to react to: the
  // shell registers intent filters, copies whatever arrives, and this collects
  // it. Checked once on load — the share is usually what launched the app — and
  // again on the event, for one that arrives while it is already open.
  //
  // Unlike the web path this does not open an empty modal when nothing is
  // waiting, because it runs on every launch rather than only after a share.
  useEffect(() => {
    if (!user) return
    let cancelled = false
    const collect = () => {
      takeNativeIncomingFiles().then(files => {
        if (cancelled || files.length === 0) return
        setIncomingFiles(files)
        setShowImport(true)
      })
    }
    collect()
    const stop = onNativeIncomingFiles(collect)
    return () => { cancelled = true; stop() }
  }, [user])

  // The one-time "how do I get my workouts in" welcome, per user per device.
  //
  // Deferred to an effect on `user` rather than shown from the login handler,
  // because signing in is not the only way to arrive here: a returning session
  // restores without ever passing through the login screen, and installing the
  // app on a second device is exactly the case this exists for.
  useEffect(() => {
    if (!user || hasSeenImportIntro(user.id)) return
    // Written now rather than on dismiss. Whatever the user does with it — reads
    // it, closes it, force-quits the app — it has been shown, and a welcome that
    // can reappear is a welcome that will.
    markImportIntroSeen(user.id)
    setShowImportIntro(true)
  }, [user])

  // "Open with" on desktop. An installed PWA that declares file_handlers is
  // launched with the files in launchQueue; Chrome and Edge on desktop are the
  // only places this exists, so the whole block is feature-detected away
  // elsewhere. Android gives an installed PWA no file association at all, which
  // is why the app registers real intent filters and arrives via the native
  // effect above rather than this one.
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
  // The URL the visible state corresponds to, refreshed after every render so
  // it covers pushState navigation as well as the pops below.
  const appliedPath = useRef(window.location.pathname + window.location.search)
  useEffect(() => {
    appliedPath.current = window.location.pathname + window.location.search
  })

  useEffect(() => {
    function onPopState() {
      // Overlays — a maximized chart, selection mode — push an entry at the
      // current URL so the back gesture closes them instead of leaving the
      // page. Popping one is not navigation, and treating it as such refetched
      // the workout and remounted the page underneath, throwing away whatever
      // state the overlay was opened from.
      if (window.location.pathname + window.location.search === appliedPath.current) return
      const loc = parseLocation()
      setPage(loc.page)
      setSection(loc.section)
      setDetail(loc.detail)
      if (loc.workoutId) {
        // Shown again immediately when it is the one we just came from, and
        // only then refreshed. The fetch takes long enough to see, and until it
        // landed the page underneath — the workouts list — was what the user
        // got, so going back from a settings page to a workout appeared to land
        // somewhere else and then correct itself.
        if (lastWorkout.current?.id === loc.workoutId) setSelectedWorkout(lastWorkout.current)
        api.getWorkout(loc.workoutId)
          .then(setSelectedWorkout)
          .catch(() => { setSelectedWorkout(null); setMissingWorkout(true) })
      } else {
        setSelectedWorkout(null)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((p: Page) => {
    setPage(p)
    setSection(null)
    setDetail(null)
    setSelectedWorkout(null)
    window.history.pushState(null, '', pathForPage(p))
  }, [])

  /**
   * Drills into a category of the current hub page, or back out of one.
   *
   * Pushed rather than replaced so the phone's back gesture and the browser's
   * back button leave the category the same way the on-screen arrow does.
   */
  const openSection = useCallback((p: Page, s: string | null, d: string | null = null) => {
    setPage(p)
    setSection(s)
    setDetail(d)
    // A workout being open wins over the page underneath it, so leaving this
    // set meant the user menu's Profile entry changed the page and the URL and
    // then carried on showing the workout — from anywhere else it worked, which
    // is exactly what makes that kind of bug hard to describe.
    setSelectedWorkout(null)
    window.history.pushState(null, '', pathForPage(p, s, d))
  }, [])

  /**
   * Opens an in-app path — a notification's deep link, or a navigation request
   * relayed by the service worker when a push is tapped. Parsed rather than
   * assigned to location.href so the SPA routes without a full reload.
   */
  const openLink = useCallback((link: string) => {
    const target = new URL(link, window.location.origin)
    // Not a page but an instruction: the update notification asks for the
    // update to start, which on Android means the install dialog and on the
    // web means picking up the build this server is now serving.
    if (target.pathname === UPDATE_LINK) {
      void startUpdate()
      return
    }
    const loc = parseLocation(target.pathname)
    if (loc.workoutId) {
      api.getWorkout(loc.workoutId)
        .then(w => {
          setSelectedWorkout(w)
          // The query string comes along, exactly as it does for a page below:
          // a social notification links to "?tab=social", and dropping it would
          // land on the charts and leave the reader to find the comment.
          // Marked like any workout we open, so closing it goes back to
          // wherever the tap came from rather than to the library.
          window.history.pushState({ workout: true }, '', `/workouts/${w.id}${target.search}`)
        })
        // A workout that has since been unshared or deleted: land on the list
        // rather than a dead end.
        .catch(() => {
          setSelectedWorkout(null)
          setPage('workouts')
          setSection(null)
          setDetail(null)
          window.history.pushState(null, '', pathForPage('workouts'))
          setMissingWorkout(true)
        })
      return
    }
    setSelectedWorkout(null)
    setPage(loc.page)
    setSection(loc.section)
    setDetail(loc.detail)
    // The query string is kept, not dropped: a notification links to a filtered
    // list ("/workouts?source=autoimport"), and pathForPage alone would land on
    // the unfiltered page and leave the user hunting.
    window.history.pushState(null, '', pathForPage(loc.page, loc.section, loc.detail) + target.search)
    // The destination page may already be mounted, in which case nothing about
    // it re-renders and a filter in the query string would be ignored. This says
    // "the URL changed" to whoever cares.
    window.dispatchEvent(new Event(LOCATION_EVENT))
  }, [])

  // Two things arrive from the service worker: a tapped OS notification asking
  // us to route, and a push that landed while the app was visible, which it
  // suppressed in favour of the in-app banner.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; url?: string; id?: string; payload?: BannerNotification } | undefined
      if (data?.type === 'NAVIGATE' && data.url) {
        // Tapping a system notification is reading it. The worker cannot mark it
        // read itself — the API wants the CSRF cookie, which a worker cannot get
        // at — so it forwards the id and the page does it.
        void markNotificationOpened(data.id)
        openLink(data.url)
      }
      if (data?.type === 'IN_APP_NOTIFICATION' && data.payload) {
        setBanner(data.payload)
        // Tell the bell to refresh its count now rather than on its next poll.
        window.dispatchEvent(new Event(PUSH_EVENT))
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [openLink])

  /**
   * A tapped Android notification.
   *
   * Here rather than in the bell, which is only mounted once someone is signed
   * in: an update notification is delivered to a device whose session may well
   * have ended, and tapping it has to work anyway — starting an update needs no
   * session, and the endpoints it uses are deliberately unauthenticated.
   *
   * Both polled and subscribed to: a cold start delivers the intent before this
   * code exists, and a tap while the app is open delivers it after. The plugin
   * hands a tap over exactly once, so this being the only consumer is what
   * makes it handled exactly once.
   */
  useEffect(() => {
    const go = (tap: NotificationTap) => {
      // Marked read before acting, not after: the user has dealt with this one,
      // and leaving it bold in the list they are about to see is the bug this
      // fixes. Fails quietly when signed out, which is the case where there is
      // no list to leave it bold in.
      void markNotificationOpened(tap.id)
      if (tap.link) {
        openLink(tap.link)
      } else if (tap.id) {
        // Nothing to navigate to — a broadcast is the message itself, so ask
        // the bell to show it in full rather than doing nothing at all.
        window.dispatchEvent(new CustomEvent(READ_NOTIFICATION_EVENT, { detail: tap.id }))
      }
    }
    void consumeNotificationTap().then(tap => { if (tap) go(tap) })
    return onNotificationTap(go)
  }, [openLink])

  // A cold start from a tapped notification, where the worker had no window to
  // message and put the id in the URL instead. Waits for auth: marking one read
  // needs a session.
  useEffect(() => {
    if (!user) return
    void markNotificationOpened(consumeOpenedParam())
  }, [user])

  // The same thing in the Android app, which has no service worker to route it.
  // The native receiver only hands a push over while this listener is attached;
  // otherwise it draws a notification, so unmounting cannot lose one.
  useEffect(() => onPushMessage(payload => {
    setBanner(payload)
    window.dispatchEvent(new Event(PUSH_EVENT))
  }), [])

  /**
   * Closes the workout, landing where it was opened from.
   *
   * It used to push the library, so the header's back arrow and the phone's
   * back gesture disagreed with each other: opening a workout from Discover, a
   * profile or a piece of equipment and pressing the arrow dumped you in your
   * own library, while the gesture returned you where you came from. Going back
   * through history is the one behaviour that is right from everywhere.
   *
   * The state marker is what distinguishes an entry this app pushed from a cold
   * load of /workouts/{id} — a deep link, a reload, a shared URL — where there
   * is nothing behind us and going back would leave the app entirely.
   */
  const closeWorkout = useCallback(() => {
    if (window.history.state?.workout) {
      window.history.back()
      return
    }
    setSelectedWorkout(null)
    window.history.replaceState(null, '', pathForPage('workouts'))
  }, [])

  /**
   * Opens a workout, marking the history entry as one we pushed.
   *
   * The marker is what lets closing it go *back* rather than forward to the
   * library — see closeWorkout.
   */
  const selectWorkout = useCallback((w: Workout | null) => {
    if (!w) { closeWorkout(); return }
    setSelectedWorkout(w)
    window.history.pushState({ workout: true }, '', `/workouts/${w.id}`)
  }, [closeWorkout])

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
        const map: Record<string, Page> = { d: 'dashboard', w: 'workouts', a: 'analysis', c: 'consistency', m: 'map', e: 'equipment', p: 'discover', t: 'plans' }
        if (map[e.key]) { navigate(map[e.key]); return }
      }
      if (e.key === 'g') { gPressed = true; setTimeout(() => { gPressed = false }, 1000); return }
      if (e.key === '[') toggleSidebar()
      if (e.key === 'Escape') {
        closeWorkout()
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
  }, [navigate, toggleSidebar, closeWorkout])

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

  /** Where the page under any drill-in was scrolled to. */
  const listScroll = useRef(0)

  /**
   * Whether a drill-in is open over the current page.
   *
   * Two of them, and they behave identically: a workout detail over the
   * workout list, and a settings category over the settings hub. Neither is a
   * page change — both replace the content inside the same scrolling <main> —
   * so the "start at the top" effect below never fires for either, and both
   * need the level above them remembered by hand.
   *
   * A boolean rather than the value itself, so opening a second category from
   * the hub is the same transition as opening the first.
   */
  const drilledIn = Boolean(selectedWorkout) || section != null

  const onMainScroll = useCallback(() => {
    if (!drilledIn && mainEl) listScroll.current = mainEl.scrollTop
  }, [drilledIn, mainEl])

  // Start each page at the top. Without this a swipe from a scrolled page
  // animates the next one in already scrolled down, which reads as a glitch.
  useEffect(() => {
    listScroll.current = 0
    mainEl?.scrollTo({ top: 0 })
  }, [page, mainEl])

  /**
   * Drill in at the top; come back where you were.
   *
   * Captured on every scroll rather than read at the moment of the transition:
   * by the time an effect could run, the content has already been replaced and
   * the container has clamped its scrollTop to whatever the new content is
   * tall enough for.
   *
   * useLayoutEffect so the restored offset is painted with the list rather than
   * a frame after it, which reads as a jump.
   */
  useLayoutEffect(() => {
    if (!mainEl) return
    mainEl.scrollTo({ top: drilledIn ? 0 : listScroll.current })
  }, [drilledIn, mainEl])

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
    // Preferences are app-wide now, not a Settings concern: the workout page
    // asks whether weather lookups are on, and Analysis asks the same to tell
    // "no data yet" apart from "you have this switched off". Mounted here, once,
    // rather than fetched again by each page that wants it.
    <PreferencesProvider>
    <WorkoutsProvider>
    <ActiveSessionProvider>
      <div className={layoutClass}>
      <TopBar
        onToggleSidebar={toggleSidebar}
        themeMode={themeMode}
        onCycleTheme={cycleTheme}
        onUserMenu={() => setShowUserMenu(v => !v)}
        onHome={() => navigate('dashboard')}
        onNavigate={openLink}
        isMobile={isMobile}
        user={user}
      />

      {banner && (
        <NotificationBanner
          notification={banner}
          onOpen={link => {
            setBanner(null)
            // Opening the banner is reading the notification, exactly as opening
            // it from the bell's list is.
            void markNotificationOpened(banner.id)
            openLink(link)
          }}
          onDismiss={() => setBanner(null)}
        />
      )}

      <UpdateToast />

      {missingWorkout && (
        <Toast
          message="That workout is no longer available"
          onDone={() => setMissingWorkout(false)}
        />
      )}

      <OfflineBar />

      {/* Desktop sidebar — hidden on mobile via CSS */}
      <Sidebar
        currentPage={navHighlight(page)}
        onNavigate={navigate}
        collapsed={sidebarCollapsed}
        sidebarWidth={sidebarWidth}
        onWidthChange={w => setSidebarWidth(w)}
        onImport={() => setShowImport(true)}
        isMobile={isMobile}
      />

      <main className="main-content" ref={mainRef} onScroll={onMainScroll}>
        <PullToRefresh scrollEl={mainEl} enabled={gesturesEnabled} onRefresh={refresh} />
        <SwipePager page={page} swipe={swipe}>
        {selectedWorkout ? (
          <WorkoutDetail
            key={selectedWorkout.id}
            workout={selectedWorkout}
            accent={accent}
            onBack={closeWorkout}
            onOpenUser={id => openSection('users', String(id))}
            onOpenSettings={() => navigate('settings')}
          />
        ) : openingWorkout ? (
          // Deliberately not the list: the URL already says a workout is
          // opening, and showing the library first would be answering a
          // question nobody asked.
          <div className="detail-loading" style={{ minHeight: '60vh' }}>
            <LoaderCircle size={18} className="spin" aria-hidden />
            Loading workout…
          </div>
        ) : page === 'dashboard' ? (
          <Dashboard
            onSelect={selectWorkout}
            onResumeSession={id => openSection('plans', 'session', id)}
            onImport={() => setShowImport(true)}
            // Through openLink, which is how every other "go here and do this"
            // in the app travels: the query string is what the page reads to
            // know it should open its own creation flow. See Equipment and
            // PlansPage, where that is picked up.
            onCreate={what => openLink(what === 'equipment' ? '/equipment?new=1' : '/plans?new=1')}
          />
        ) : page === 'workouts' ? (
          <Workouts onSelect={selectWorkout} onImport={() => setShowImport(true)} />
        ) : page === 'analysis' ? (
          <Analysis />
        ) : page === 'map' ? (
          <Suspense fallback={<div className="page-content page-loading">Loading map…</div>}>
            <MapPage />
          </Suspense>
        ) : page === 'consistency' ? (
          <Consistency />
        ) : page === 'discover' ? (
          // A plan or session found here opens *under* Discover — see
          // DISCOVER_SECTIONS in nav.ts for why it does not go to /plans.
          section === 'plan' || section === 'session' ? (
            <Suspense fallback={<div className="page-content page-loading">Loading…</div>}>
              <PlansPage
                // PlansPage takes a plan id as its section, or the literal
                // "session" with the id in detail. /discover/plan/{id} carries
                // the id one segment further out, so it is shifted back here.
                section={section === 'session' ? 'session' : detail}
                detail={section === 'session' ? detail : null}
                onOpen={(sec, det) => {
                  // Back out of the item, to the feed it was found in.
                  if (!sec) return openSection('discover', null)
                  // A session stays under Discover; a bare id is a clone, which
                  // is yours now and belongs in your own library.
                  if (sec === 'session') return openSection('discover', 'session', det ?? null)
                  return openSection('plans', sec)
                }}
                onOpenUser={id => openSection('users', String(id))}
              />
            </Suspense>
          ) : (
            <Discover
              onOpenUser={id => openSection('users', String(id))}
              onSelectWorkout={selectWorkout}
              onSelectPlan={p => openSection('discover', 'plan', p.id)}
              onSelectSession={s => openSection('discover', 'session', s.id)}
            />
          )
        ) : page === 'users' ? (
          // section carries the user id; see ID_SECTION_PAGES in nav.ts.
          <UserProfile
            id={Number(section)}
            onBack={() => window.history.back()}
            onSelect={selectWorkout}
            onOpenUser={id => openSection('users', String(id))}
            // Under Discover, like anything else of someone else's — see
            // DISCOVER_SECTIONS in nav.ts.
            onSelectPlan={p => openSection('discover', 'plan', p.id)}
            onSelectSession={s => openSection('discover', 'session', s.id)}
          />
        ) : page === 'equipment' ? (
          <Equipment
            detail={section}
            onOpenDetail={id => openSection('equipment', id)}
            onSelectWorkout={id => { api.getWorkout(id).then(selectWorkout).catch(() => {}) }}
          />
        ) : page === 'plans' ? (
          // section is a plan id, or "session" with the id in detail; see
          // ID_SECTION_PAGES in nav.ts.
          <Suspense fallback={<div className="page-content page-loading">Loading plans…</div>}>
            <PlansPage
              section={section}
              detail={detail}
              onOpen={(sec, det) => openSection('plans', sec, det ?? null)}
              onOpenUser={id => openSection('users', String(id))}
            />
          </Suspense>
        ) : page === 'settings' ? (
          <Settings
            section={section as SettingsSection | null}
            onOpen={s => openSection('settings', s)}
            onBack={() => openSection('settings', null)}
            accent={accent}
            onAccentChange={setAccent}
            themeMode={themeMode}
            onThemeChange={setThemeMode}
            display={display}
            onDisplayChange={setDisplay}
            onViewProfile={() => { if (user) openSection('users', String(user.id)) }}
          />
        ) : page === 'admin' ? (
          <Admin
            section={section as AdminSection | null}
            userId={detail}
            onOpen={s => openSection('admin', s)}
            onOpenUser={id => openSection('admin', 'users', id === null ? null : String(id))}
            onBack={() => openSection('admin', null)}
          />
        ) : (
          <Help />
        )}
        </SwipePager>
      </main>

      {/* Mobile bottom bar */}
      {isMobile && (
        <BottomBar currentPage={navHighlight(page)} onNavigate={navigate} />
      )}

      {/* Overlays */}
      {showUserMenu && (
        <UserMenu
          onClose={() => setShowUserMenu(false)}
          onSettings={() => navigate('settings')}
          onProfile={() => openSection('settings', 'profile')}
          onAdmin={() => navigate('admin')}
          onLogout={logout}
          user={user}
        />
      )}
      {showImportIntro && user && (
        <ImportIntro onClose={() => setShowImportIntro(false)} />
      )}
      {showImport && (
        <ImportModal
          initialFiles={incomingFiles}
          onClose={() => { setShowImport(false); setIncomingFiles(null) }}
          onViewWorkout={w => { selectWorkout(w); setShowImport(false); setIncomingFiles(null) }}
        />
      )}
      </div>
    </ActiveSessionProvider>
    </WorkoutsProvider>
    </PreferencesProvider>
  )
}
