export type Page =
  | 'dashboard'
  | 'workouts'
  | 'analysis'
  | 'consistency'
  | 'map'
  | 'equipment'
  /** Training plans, and the sessions run against them. */
  | 'plans'
  /** Everyone on this instance; each entry opens their profile. */
  | 'discover'
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
export const MOBILE_PAGES: Page[] = ['dashboard', 'workouts', 'discover', 'plans', 'analysis', 'consistency', 'map', 'equipment']

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
export const BOTTOM_BAR_PAGES: Page[] = ['dashboard', 'workouts', 'discover', 'plans']

/**
 * The pages behind "More" on a phone, in the same order they appear in the
 * desktop sidebar.
 *
 * The bar and the sheet are read as one list, so what matters is that walking
 * bar-then-sheet gives the same order as the sidebar. That is why Plans sits in
 * the bar and Analysis leads the sheet rather than the other way round.
 */
export const MORE_PAGES: Page[] = ['analysis', 'consistency', 'map', 'equipment', 'help']

/** Every page that owns a route, including the ones reached from the user menu. */
export const PAGES: Page[] = [...DESKTOP_PAGES, 'settings', 'admin', 'users']
/** Whether this account may render a page reached directly or through history. */
export function canAccessPage(page: Page, isAdmin: boolean): boolean {
  return page !== 'admin' || isAdmin
}

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
  'plans',
  'autoimport', 'app', 'server',
] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number]

export const ADMIN_SECTIONS = ['users', 'feedback', 'email', 'sso', 'storage', 'social'] as const
export type AdminSection = typeof ADMIN_SECTIONS[number]

/**
 * A plan or a session belonging to somebody else, at `/discover/plan/{id}`
 * and `/discover/session/{id}`.
 *
 * Under Discover rather than under Plans, because that is where it was found
 * and that is what the nav should say while it is open. Routing someone
 * else's plan to `/plans/{id}` lit up the Plans tab — which is your own
 * library, the one place the thing on screen is certainly not — and pressing
 * that tab then went somewhere you were apparently already at.
 *
 * The page rendered is still PlansPage: the item is the same item, only the
 * route it hangs off differs. A clone, being yours, moves to `/plans/{id}`.
 */
export const DISCOVER_SECTIONS = ['plan', 'session'] as const
export type DiscoverSection = typeof DISCOVER_SECTIONS[number]

/** The section ids valid under a given hub page. */
function sectionsFor(page: Page): readonly string[] {
  if (page === 'settings') return SETTINGS_SECTIONS
  if (page === 'admin') return ADMIN_SECTIONS
  if (page === 'discover') return DISCOVER_SECTIONS
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
const ID_SECTION_PAGES: readonly Page[] = ['equipment', 'users', 'plans']

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
  /**
   * One record inside a category — the account open under Admin > Users.
   *
   * In the URL for the same reason equipment's id is: which account is open was
   * component state, so leaving the page for a workout or a profile unmounted
   * the thing holding it, and the back gesture landed on the list of categories
   * rather than on the user you were looking at.
   */
  detail: string | null
  workoutId: string | null
  /** The URL is not the one this location owns — a legacy form, or nothing at
   *  all — and should be rewritten to `pathForPage` of what was resolved. */
  redirect?: boolean
}

/**
 * The nav item that should light up while `page` is open.
 *
 * A page reached *through* another one still belongs to it: opening someone's
 * profile from Discover, or one of their workouts from there, does not stop
 * you being in Discover. Without this the bar highlighted nothing at all, which
 * reads as "you are nowhere" — the same failure the More button was given a
 * highlight to avoid.
 */
export function navHighlight(page: Page): Page {
  // Profiles are only ever reached from Discover, a shared workout, or a
  // notification; Discover is the only one of those that is a nav item.
  if (page === 'users') return 'discover'
  return page
}

/** The path for a page, optionally drilled into one of its categories. */
export function pathForPage(p: Page, section?: string | null, detail?: string | null): string {
  const base = p === 'dashboard' ? '/' : `/${p}`
  if (!section) return base
  return detail ? `${base}/${section}/${detail}` : `${base}/${section}`
}

/**
 * URL to app state. Routes are path-based (`/workouts`, `/workouts/:id`,
 * `/settings/appearance`) so a reload lands back where it was rather than
 * resetting to the dashboard.
 */
export function parseLocation(pathname = window.location.pathname): AppLocation {
  const segs = pathname.split('/').filter(Boolean)
  if (segs.length === 0) return { page: 'dashboard', section: null, detail: null, workoutId: null }

  if (segs[0] === 'workouts' && segs[1]) {
    return { page: 'workouts', section: null, detail: null, workoutId: segs[1] }
  }

  const candidate = segs[0] as Page
  if (PAGES.includes(candidate)) {
    // An unrecognised category is dropped rather than honoured: better to open
    // the hub than to render nothing.
    const section = segs[1] && (ID_SECTION_PAGES.includes(candidate) || sectionsFor(candidate).includes(segs[1]))
      ? segs[1]
      : null
    // A detail only means anything under a category, and only the pages that
    // render one look at it — an unknown trailing segment elsewhere is inert.
    return { page: candidate, section, detail: section ? segs[2] ?? null : null, workoutId: null }
  }

  const moved = LEGACY_SECTION_ROUTES[segs[0]]
  if (moved) return { ...moved, detail: null, workoutId: null, redirect: true }

  // Timeline was folded into Analysis and Heatmap became Consistency; keep old
  // links and open tabs working instead of dumping them on the dashboard.
  const legacy = LEGACY_ROUTES[segs[0]]
  if (legacy) return { page: legacy, section: null, detail: null, workoutId: null, redirect: true }

  /*
   * An unrecognised path falls back to the dashboard, and says so in the URL.
   *
   * It used to render the dashboard while leaving `/whatever-you-typed` in the
   * address bar, so the page and the URL disagreed: a reload, a bookmark or a
   * shared link all came back to the same wrong address, and the app looked
   * like it had a page there that it does not.
   */
  return { page: 'dashboard', section: null, detail: null, workoutId: null, redirect: true }
}

/** The page `steps` positions away from `from` in MOBILE_PAGES, wrapping. */
export function adjacentPage(from: Page, steps: number): Page | null {
  const i = MOBILE_PAGES.indexOf(from)
  if (i === -1) return null
  return MOBILE_PAGES[(i + steps + MOBILE_PAGES.length) % MOBILE_PAGES.length]
}
