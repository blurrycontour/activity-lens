export type Page =
  | 'dashboard'
  | 'workouts'
  | 'analysis'
  | 'consistency'
  | 'equipment'
  | 'help'
  | 'settings'
  | 'account'
  | 'admin'

/**
 * The primary pages, in the order both the sidebar and the mobile bottom bar
 * show them. Mobile swipe navigation walks this list cyclically, so swiping
 * right on the first page wraps around to the last.
 */
export const MOBILE_PAGES: Page[] = ['dashboard', 'workouts', 'analysis', 'consistency', 'equipment']

/** Sidebar order on desktop: the mobile set plus Help. */
export const DESKTOP_PAGES: Page[] = [...MOBILE_PAGES, 'help']

/**
 * Routes that no longer exist, pointing at whatever absorbed them. Timeline was
 * merged into Analysis and Heatmap was renamed Consistency, so old bookmarks
 * and open tabs still land somewhere sensible.
 */
export const LEGACY_ROUTES: Record<string, Page> = {
  timeline: 'analysis',
  heatmap: 'consistency',
}

/** The page `steps` positions away from `from` in MOBILE_PAGES, wrapping. */
export function adjacentPage(from: Page, steps: number): Page | null {
  const i = MOBILE_PAGES.indexOf(from)
  if (i === -1) return null
  return MOBILE_PAGES[(i + steps + MOBILE_PAGES.length) % MOBILE_PAGES.length]
}
