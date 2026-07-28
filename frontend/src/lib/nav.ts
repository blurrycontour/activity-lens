export type Page =
  | 'dashboard'
  | 'workouts'
  | 'heatmap'
  | 'timeline'
  | 'analysis'
  | 'equipment'
  | 'help'
  | 'settings'
  | 'account'
  | 'admin'

/**
 * The primary pages, in the order the mobile bottom bar shows them. Mobile
 * swipe navigation walks this list cyclically, so swiping right on the first
 * page wraps around to the last.
 */
export const MOBILE_PAGES: Page[] = ['dashboard', 'workouts', 'heatmap', 'timeline', 'analysis']

/** The page `steps` positions away from `from` in MOBILE_PAGES, wrapping. */
export function adjacentPage(from: Page, steps: number): Page | null {
  const i = MOBILE_PAGES.indexOf(from)
  if (i === -1) return null
  return MOBILE_PAGES[(i + steps + MOBILE_PAGES.length) % MOBILE_PAGES.length]
}
