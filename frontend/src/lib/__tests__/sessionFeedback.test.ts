import { describe, expect, it } from 'vitest'
import { PATTERNS } from '../sessionFeedback'

describe('vibration patterns', () => {
  /*
   * The rule this exists to keep.
   *
   * A pattern of one number is a single buzz, and on the phone this app was
   * built against a single buzz does not arrive: the signal that ends a
   * session is felt and the one that discards it is not, with identical code
   * on both sides of the call. Nothing above the platform explains it, so the
   * rule is simply never to ask for one — which is a rule a later edit would
   * break by writing the obvious thing for a new signal.
   */
  it('never asks for a lone pulse', () => {
    for (const [kind, pattern] of Object.entries(PATTERNS)) {
      expect(pattern.length, `${kind} is a single buzz`).toBeGreaterThan(1)
    }
  })

  it('alternates buzz and pause, so it ends on a buzz', () => {
    for (const [kind, pattern] of Object.entries(PATTERNS)) {
      expect(pattern.length % 2, `${kind} ends on a pause`).toBe(1)
      for (const ms of pattern) expect(ms, `${kind} has a zero step`).toBeGreaterThan(0)
    }
  })
})
