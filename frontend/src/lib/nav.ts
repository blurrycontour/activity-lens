export type Page =
  | 'dashboard'
  | 'workouts'
  | 'analysis'
  | 'consistency'
  | 'equipment'
  | 'help'
  | 'settings'
  | 'admin'

/**
 * The primary pages, in the order both the sidebar and the mobile bottom bar
 * show them. Mobile swipe navigation walks this list cyclically, so swiping
 * right on the first page wraps around to the last.
 */
export const MOBILE_PAGES: Page[] = ['dashboard', 'workouts', 'analysis', 'consistency', 'equipment']

/** Sidebar order on desktop: the mobile set plus Help. */
export const DESKTOP_PAGES: Page[] = [...MOBILE_PAGES, 'help']

/** Every page that owns a route, including the ones reached from the user menu. */
export const PAGES: Page[] = [...DESKTOP_PAGES, 'settings', 'admin']

/**
 * Settings and admin are hubs: each category is a page of its own at
 * `/settings/<id>`, drilled into and backed out of like a workout. Listing the
 * ids here keeps the router honest — an unknown one lands on the hub rather
 * than a blank screen.
 */
export const SETTINGS_SECTIONS = [
  'profile', 'security', 'body',
  'appearance', 'dashboard', 'goals', 'notifications',
  'feedback',
  'autoimport', 'app', 'server',
] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number]

export const ADMIN_SECTIONS = ['users', 'feedback', 'email', 'sso', 'storage'] as const
export type AdminSection = typeof ADMIN_SECTIONS[number]

/** The section ids valid under a given hub page. */
function sectionsFor(page: Page): readonly string[] {
  if (page === 'settings') return SETTINGS_SECTIONS
  if (page === 'admin') return ADMIN_SECTIONS
  return []
}

/**
 * Routes that no longer exist, pointing at whatever absorbed them. Timeline was
 * merged into Analysis and Heatmap was renamed Consistency, so old bookmarks
 * and open tabs still land somewhere sensible.
 */
export const LEGACY_ROUTES: Record<string, Page> = {
  timeline: 'analysis',
  heatmap: 'consistency',
}

/**
 * Account is now a group inside Settings rather than a page. Its old URL keeps
 * working by landing on the profile category, which is what it opened on.
 */
export const LEGACY_SECTION_ROUTES: Record<string, { page: Page; section: SettingsSection }> = {
  account: { page: 'settings', section: 'profile' },
}

export interface AppLocation {
  page: Page
  /** The category within a hub page, or null for the hub itself. */
  section: string | null
  workoutId: string | null
  /** The URL was a legacy form and should be rewritten. */
  redirect?: boolean
}

/** The path for a page, optionally drilled into one of its categories. */
export function pathForPage(p: Page, section?: string | null): string {
  const base = p === 'dashboard' ? '/' : `/${p}`
  return section ? `${base}/${section}` : base
}

/**
 * URL to app state. Routes are path-based (`/workouts`, `/workouts/:id`,
 * `/settings/appearance`) so a reload lands back where it was rather than
 * resetting to the dashboard.
 */
export function parseLocation(pathname = window.location.pathname): AppLocation {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length === 0) return { page: 'dashboard', section: null, workoutId: null }

  if (segs[0] === 'workouts' && segs[1]) {
    return { page: 'workouts', section: null, workoutId: segs[1] }
  }

  const candidate = segs[0] as Page
  if (PAGES.includes(candidate)) {
    // An unrecognised category is dropped rather than honoured: better to open
    // the hub than to render nothing.
    const section = segs[1] && sectionsFor(candidate).includes(segs[1]) ? segs[1] : null
    return { page: candidate, section, workoutId: null }
  }

  const moved = LEGACY_SECTION_ROUTES[segs[0]]
  if (moved) return { ...moved, workoutId: null, redirect: true }

  // Timeline was folded into Analysis and Heatmap became Consistency; keep old
  // links and open tabs working instead of dumping them on the dashboard.
  const legacy = LEGACY_ROUTES[segs[0]]
  if (legacy) return { page: legacy, section: null, workoutId: null, redirect: true }

  return { page: 'dashboard', section: null, workoutId: null }
}

/** The page `steps` positions away from `from` in MOBILE_PAGES, wrapping. */
export function adjacentPage(from: Page, steps: number): Page | null {
  const i = MOBILE_PAGES.indexOf(from)
  if (i === -1) return null
  return MOBILE_PAGES[(i + steps + MOBILE_PAGES.length) % MOBILE_PAGES.length]
}
