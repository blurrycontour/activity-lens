import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasSeenImportIntro, markImportIntroSeen } from '../ImportIntro'

/**
 * A welcome that reappears is worse than one nobody sees, and both failures are
 * silent — the first only annoys people who already know how the app works, and
 * the second only affects someone who has not signed in yet. Neither shows up
 * in ordinary use of the app, so they get a test.
 */

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size },
  } as Storage
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
})

describe('the import introduction is shown once per user per device', () => {
  it('is unseen until it has been marked', () => {
    expect(hasSeenImportIntro(1)).toBe(false)
    markImportIntroSeen(1)
    expect(hasSeenImportIntro(1)).toBe(true)
  })

  // Two people sharing a tablet is the case: the second to sign in has never
  // been told anything, and keying the flag on the device alone would skip it.
  it('is tracked separately for each user', () => {
    markImportIntroSeen(1)
    expect(hasSeenImportIntro(2)).toBe(false)
  })

  it('stays seen once marked, however many times it is asked', () => {
    markImportIntroSeen(7)
    markImportIntroSeen(7)
    expect(hasSeenImportIntro(7)).toBe(true)
  })

  // Private browsing, a full quota, storage disabled by policy. Reporting "not
  // seen" would put the dialog in front of the user on every single launch with
  // no way to stop it, which is the worse of the two failures.
  it('reports seen rather than looping when storage cannot be read', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    } as unknown as Storage)
    expect(hasSeenImportIntro(1)).toBe(true)
    // And marking must not throw into the caller, which runs during render.
    expect(() => markImportIntroSeen(1)).not.toThrow()
  })
})
