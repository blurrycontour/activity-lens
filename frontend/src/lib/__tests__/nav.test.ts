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

  // The dashboard is the fallback, but the URL has to say so: rendering the
  // dashboard while leaving /nonsense in the address bar means a reload, a
  // bookmark and a shared link all come back to a page that does not exist.
  it('flags an unrecognised path for rewriting', () => {
    expect(parseLocation('/nonsense')).toMatchObject({ page: 'dashboard', redirect: true })
  })

  // The two that genuinely are the dashboard must not be rewritten — there is
  // nothing to rewrite them to, and doing it anyway pushes a history entry.
  it('leaves the real dashboard route alone', () => {
    expect(parseLocation('/').redirect).toBeUndefined()
    expect(parseLocation('/dashboard').redirect).toBeUndefined()
  })

  // An unknown category must not render a blank page — it falls back to the hub.
  it('drops a category the hub does not have', () => {
    expect(parseLocation('/settings/nonsense')).toMatchObject({ page: 'settings', section: null })
    expect(parseLocation('/admin/appearance')).toMatchObject({ page: 'admin', section: null })
  })

  // Gear is user-created, so there is no list of valid ids to check against —
  // which is exactly why an equipment id must survive the round trip while a
  // bogus settings category still does not. Being in the URL is what lets the
  // back gesture return to the piece of gear a workout was opened from, rather
  // than to the inventory.
  it('keeps an equipment id, which is a section with no fixed list', () => {
    expect(parseLocation('/equipment/e_277564788d8a7affaff28c0f'))
      .toMatchObject({ page: 'equipment', section: 'e_277564788d8a7affaff28c0f', workoutId: null })
    expect(parseLocation(pathForPage('equipment', 'e_abc')))
      .toMatchObject({ page: 'equipment', section: 'e_abc' })
    // And the bare page is still the inventory.
    expect(parseLocation('/equipment')).toMatchObject({ page: 'equipment', section: null })
  })

  // A profile is reached from a shared workout and owns a route so the back
  // gesture returns there. Same open-ended section as equipment: the id is a
  // user, and there is no list of valid ones to check against.
  it('reads a user id as a profile route', () => {
    expect(parseLocation('/users/42')).toMatchObject({ page: 'users', section: '42', workoutId: null })
    expect(parseLocation(pathForPage('users', '7'))).toMatchObject({ page: 'users', section: '7' })
  })

  // Which account is open under Admin > Users is in the URL, so leaving the
  // page for a workout and coming back lands on the account, not the category
  // list. Round-tripped rather than asserted one way: the two halves drifting
  // is exactly how a back gesture silently starts landing in the wrong place.
  it('carries a record open inside a category', () => {
    expect(pathForPage('admin', 'users', '42')).toBe('/admin/users/42')
    expect(parseLocation('/admin/users/42')).toMatchObject({ page: 'admin', section: 'users', detail: '42' })
    expect(parseLocation(pathForPage('admin', 'users'))).toMatchObject({ section: 'users', detail: null })
    // No category, no record: a stray segment cannot conjure one.
    expect(pathForPage('admin', null, '42')).toBe('/admin')
    expect(parseLocation('/admin/nonsense/42')).toMatchObject({ section: null, detail: null })
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
