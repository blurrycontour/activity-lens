import { useEffect, useRef, useState } from 'react'

/**
 * The playback position, as a value that can be read 60 times a second without
 * re-rendering anything.
 *
 * Track playback has two audiences moving at very different speeds. The marker
 * on the map wants every frame — anything less and it visibly steps. The charts,
 * the time readout and the zone bars want to keep up, but nobody can tell
 * whether they refresh 60 times a second or 10.
 *
 * Driving both from one piece of React state meant the slow audience paid the
 * fast one's bill: every frame re-rendered the whole detail page, re-sliced each
 * chart's data to the playhead and re-rendered six Recharts SVGs. That is the
 * entire frame budget, and MapLibre — which needs the main thread to answer a
 * pan or a zoom — never got a look in. The map was smooth until you pressed
 * play, which is exactly the shape of the bug.
 *
 * So the precise value lives here, outside React, and subscribers that need it
 * per frame take it directly. React state carries a coarser copy for everyone
 * else. See useThrottledPlayhead.
 */
export interface Playhead {
  /** The current position in seconds. Always exact. */
  readonly value: number
  /** Moves the playhead and notifies subscribers synchronously. */
  set(t: number): void
  /** Calls fn on every change, and once immediately. Returns an unsubscribe. */
  subscribe(fn: (t: number) => void): () => void
}

export function usePlayhead(initial: number): Playhead {
  const ref = useRef<Playhead>(undefined as unknown as Playhead)
  if (!ref.current) {
    let value = initial
    const subs = new Set<(t: number) => void>()
    ref.current = {
      get value() { return value },
      set(t: number) {
        if (t === value) return
        value = t
        for (const fn of subs) fn(t)
      },
      subscribe(fn) {
        subs.add(fn)
        fn(value)
        return () => { subs.delete(fn) }
      },
    }
  }
  return ref.current
}

/**
 * How often the playhead is published to React, in milliseconds.
 *
 * 100ms is under the threshold where a chart cursor reads as stepping rather
 * than sliding, and it is a sixth of the work sixty frames a second would be.
 */
const PUBLISH_MS = 100

/**
 * A React state copy of the playhead, updated at a rate a chart can afford.
 *
 * Changes made while playback is stopped — a scrub, reset, jump to end — are
 * published immediately regardless, because there is no following frame to
 * carry them and a cursor that lags a deliberate action by a tenth of a second
 * looks broken rather than smooth.
 */
export function useThrottledPlayhead(playhead: Playhead, playing: boolean): number {
  const [value, setValue] = useState(playhead.value)

  useEffect(() => {
    let last = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const unsubscribe = playhead.subscribe(t => {
      if (timer) { clearTimeout(timer); timer = undefined }
      const now = performance.now()
      if (!playing || now - last >= PUBLISH_MS) {
        last = now
        setValue(t)
        return
      }
      // Trailing edge, so the last frame before a pause is not left unpublished
      // and the charts do not stop a fraction short of where the marker is.
      timer = setTimeout(() => { last = performance.now(); setValue(playhead.value) }, PUBLISH_MS - (now - last))
    })
    return () => { unsubscribe(); if (timer) clearTimeout(timer) }
  }, [playhead, playing])

  return value
}
