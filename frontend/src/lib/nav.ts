export type Page =
  | 'dashboard'
  | 'workouts'
  | 'analysis'
  | 'consistency'
  | 'map'
  | 'equipment'
  | 'help'
  | 'settings'
  | 'admin'
  /**
   * Another member's profile, at /users/{id}.
   *
   * Not in MOBILE_PAGES or the sidebar: there is no "users" hub to navigate
   * to, only individual people reached from a shared or public workout. It
   * owns a route so the back gesture returns to the workout you came from and
   * so a profile can be linked.
   */
  | 'users'

/**
 * The primary pages, in order. Mobile swipe navigation walks this list
 * cyclically, so swiping right on the first page wraps around to the last.
 */
export const MOBILE_PAGES: Page[] = ['dashboard', 'workouts', 'analysis', 'consistency', 'map', 'equipment']

/** Sidebar order on desktop: the mobile set plus Help. */
export const DESKTOP_PAGES: Page[] = [...MOBILE_PAGES, 'help']

/**
 * What the phone's bottom bar shows, beside a "More" button.
 *
 * Four, not six. A tab bar is thumb-sized targets and readable labels, and both
 * shrink as items are added — six across a phone leaves each one narrower than
 * the finger meant to hit it, and the labels start eliding. Four plus More is
 * the shape every platform's guidelines land on for the same reason.
 *
 * Everything still reachable: the rest live behind More, and swipe navigation
 * walks all of MOBILE_PAGES regardless.
 */
export const BOTTOM_BAR_PAGES: Page[] = ['dashboard', 'workouts', 'analysis', 'consistency']

/** The pages behind "More" on a phone. */
export const MORE_PAGES: Page[] = ['map', 'equipment', 'help']

/** Every page that owns a route, including the ones reached from the user menu. */
export const PAGES: Page[] = [...DESKTOP_PAGES, 'settings', 'admin', 'users']

/**
 * Settings and admin are hubs: each category is a page of its own at
 * `/settings/<id>`, drilled into and backed out of like a workout. Listing the
 * ids here keeps the router honest — an unknown one lands on the hub rather
 * than a blank screen.
 */
export const SETTINGS_SECTIONS = [
  'profile', 'security', 'body',
  'appearance', 'dashboard', 'goals', 'notifications', 'weather',
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
 * Pages whose section is an id rather than one of a fixed set.
 *
 * Equipment drills into a piece of gear, and gear is created by the user, so
 * there is no list to check a segment against — anything non-empty is taken as
 * an id and the page reports it missing if it is not.
 *
 * Being in the URL at all is what makes the back gesture work: opening a
 * workout from a piece of gear replaces the whole page, so the equipment
 * component unmounts and any id it was holding in local state goes with it.
 * Coming back then landed on the inventory rather than the gear you left.
 */
const ID_SECTION_PAGES: readonly Page[] = ['equipment', 'users']

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
    const section = segs[1] && (ID_SECTION_PAGES.includes(candidate) || sectionsFor(candidate).includes(segs[1]))
      ? segs[1]
      : null
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
