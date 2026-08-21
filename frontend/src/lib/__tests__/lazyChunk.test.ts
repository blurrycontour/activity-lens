import { describe, expect, it } from 'vitest'
import { handleChunkFailure, type RetryHost } from '../lazyChunk'

/**
 * A fake browser: a clock, a session store and a reload counter.
 */
function host(overrides: Partial<{ now: number; stored: string | null }> = {}) {
  let stored = overrides.stored ?? null
  let reloads = 0
  const h: RetryHost = {
    now: () => overrides.now ?? 1_000_000,
    read: () => stored,
    write: v => { stored = v },
    clear: () => { stored = null },
    reload: () => { reloads++ },
  }
  return { h, reloads: () => reloads, stored: () => stored }
}

/*
 * Both outcomes here are invisible from a type check and awful in a browser: a
 * page that reloads itself forever, or a page permanently stuck on a spinner
 * after a deploy. The decision is pure so it can be pinned.
 */
describe('handleChunkFailure', () => {
  it('reloads the first time a chunk will not load', () => {
    const { h, reloads, stored } = host()
    expect(handleChunkFailure(h)).toBe(true)
    expect(reloads()).toBe(1)
    // The attempt is recorded, so the next failure knows this already happened.
    expect(stored()).not.toBeNull()
  })

  it('does not reload twice for the same failure', () => {
    // A reload was recorded a second ago and the chunk still will not load:
    // this is not a stale build, and another reload is a loop.
    const { h, reloads } = host({ now: 1_000_000, stored: String(1_000_000 - 1_000) })
    expect(handleChunkFailure(h)).toBe(false)
    expect(reloads()).toBe(0)
  })

  it('tries again for a failure long after the last one', () => {
    // Same tab, an hour later, a second deploy. That is a fresh problem.
    const { h, reloads } = host({ now: 5_000_000, stored: String(1_000_000) })
    expect(handleChunkFailure(h)).toBe(true)
    expect(reloads()).toBe(1)
  })

  it('clears the mark when it gives up, so a later failure may retry', () => {
    const { h, stored } = host({ now: 1_000_000, stored: String(1_000_000 - 1_000) })
    handleChunkFailure(h)
    expect(stored()).toBeNull()
  })
})
