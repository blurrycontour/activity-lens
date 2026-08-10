import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_DASHBOARD_CONFIG, MOBILE_DEFAULT_CARDS, STAT_CARDS, defaultDashboardConfig,
} from '../dashboardConfig'

/** Stands in for matchMedia, answering `matches` for the mobile query only. */
function mockViewport(narrow: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: narrow && q.includes('max-width'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('defaultDashboardConfig', () => {
  it('gives a phone a short card list and a desktop the full one', () => {
    mockViewport(true)
    expect(defaultDashboardConfig().cards).toEqual(MOBILE_DEFAULT_CARDS)
    mockViewport(false)
    expect(defaultDashboardConfig().cards).toEqual(STAT_CARDS.map(c => c.id))
  })

  it('changes nothing but the cards', () => {
    // The seed differs by device in exactly one way. If a second field started
    // varying by viewport, a user resizing a window would silently get a
    // different dashboard, and nothing would say why.
    mockViewport(true)
    const { cards, ...rest } = defaultDashboardConfig()
    const { cards: _ignored, ...baseline } = DEFAULT_DASHBOARD_CONFIG
    expect(cards).not.toEqual(_ignored)
    expect(rest).toEqual(baseline)
  })

  it('names only real cards', () => {
    const known = new Set(STAT_CARDS.map(c => c.id))
    for (const id of MOBILE_DEFAULT_CARDS) expect(known.has(id)).toBe(true)
  })

  it('falls back to the full list where there is no matchMedia', () => {
    // Server-side rendering and the odd embedded WebView have no matchMedia;
    // the wrong answer there is a crash, not a long card list.
    vi.stubGlobal('matchMedia', undefined)
    expect(defaultDashboardConfig().cards).toEqual(STAT_CARDS.map(c => c.id))
  })
})
