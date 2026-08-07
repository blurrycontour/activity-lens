import { describe, expect, it } from 'vitest'
import { ADMIN_SECTIONS, BOTTOM_BAR_PAGES, DESKTOP_PAGES, MOBILE_PAGES, MORE_PAGES, SETTINGS_SECTIONS, parseLocation, pathForPage } from '../nav'

describe('pathForPage', () => {
  it('maps the dashboard to the root', () => {
    expect(pathForPage('dashboard')).toBe('/')
  })

  it('drills into a hub category', () => {
    expect(pathForPage('settings', 'appearance')).toBe('/settings/appearance')
    expect(pathForPage('admin', 'users')).toBe('/admin/users')
  })

  it('omits the category when there is none', () => {
    expect(pathForPage('settings', null)).toBe('/settings')
    expect(pathForPage('settings')).toBe('/settings')
  })
})

describe('parseLocation', () => {
  it('reads a bare page', () => {
    expect(parseLocation('/workouts')).toMatchObject({ page: 'workouts', section: null, workoutId: null })
  })

  it('reads a workout id', () => {
    expect(parseLocation('/workouts/abc123')).toMatchObject({ page: 'workouts', workoutId: 'abc123' })
  })

  it('reads a settings category', () => {
    expect(parseLocation('/settings/security')).toMatchObject({ page: 'settings', section: 'security' })
  })

  it('reads an admin category', () => {
    expect(parseLocation('/admin/sso')).toMatchObject({ page: 'admin', section: 'sso' })
  })

  // An unknown category must not render a blank page — it falls back to the hub.
  it('drops a category the hub does not have', () => {
    expect(parseLocation('/settings/nonsense')).toMatchObject({ page: 'settings', section: null })
    expect(parseLocation('/admin/appearance')).toMatchObject({ page: 'admin', section: null })
  })

  it('round-trips every declared category', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(parseLocation(pathForPage('settings', s))).toMatchObject({ page: 'settings', section: s })
    }
    for (const s of ADMIN_SECTIONS) {
      expect(parseLocation(pathForPage('admin', s))).toMatchObject({ page: 'admin', section: s })
    }
  })

  it('sends the retired /account URL to the profile category', () => {
    expect(parseLocation('/account')).toMatchObject({
      page: 'settings', section: 'profile', redirect: true,
    })
  })

  it('keeps the older page redirects working', () => {
    expect(parseLocation('/timeline')).toMatchObject({ page: 'analysis', redirect: true })
    expect(parseLocation('/heatmap')).toMatchObject({ page: 'consistency', redirect: true })
  })

  it('falls back to the dashboard for anything unknown', () => {
    expect(parseLocation('/nope')).toMatchObject({ page: 'dashboard', section: null })
    expect(parseLocation('/')).toMatchObject({ page: 'dashboard', section: null })
  })
})

/*
 * The phone's tab bar. Six items across a phone left each one narrower than the
 * finger meant to hit it and started eliding the labels, so four sit in the bar
 * and the rest live behind More.
 */
describe('the phone tab bar', () => {
  it('keeps the bar to four tabs plus More', () => {
    expect(BOTTOM_BAR_PAGES).toHaveLength(4)
  })

  // The failure this guards against is a page that exists, has a route, and
  // cannot be reached by tapping anything.
  it('leaves no page unreachable', () => {
    const reachable = new Set([...BOTTOM_BAR_PAGES, ...MORE_PAGES])
    for (const page of DESKTOP_PAGES) {
      expect(reachable.has(page), `${page} is in the sidebar but not on the phone`).toBe(true)
    }
  })

  it('never shows the same page twice', () => {
    const all = [...BOTTOM_BAR_PAGES, ...MORE_PAGES]
    expect(new Set(all).size).toBe(all.length)
  })

  // Swipe navigation is the other way around the app, and it walks its own
  // list — every page it can land on has to be somewhere in the bar too, or a
  // swipe leaves the bar highlighting nothing.
  it('accounts for every page a swipe can reach', () => {
    const reachable = new Set([...BOTTOM_BAR_PAGES, ...MORE_PAGES])
    for (const page of MOBILE_PAGES) {
      expect(reachable.has(page), `a swipe reaches ${page}, which the bar does not show`).toBe(true)
    }
  })
})
