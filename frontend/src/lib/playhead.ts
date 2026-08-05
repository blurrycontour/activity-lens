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
 * A React state copy of the playhead, published at most once per frame.
 *
 * Aligned to requestAnimationFrame rather than a fixed interval, and that is the
 * important part: several playhead moves inside one frame collapse into a single
 * render, and when the main thread is busy — the map is being panned, say — the
 * browser fires fewer callbacks and this throttles itself. A fixed timer does
 * the opposite, queueing renders the frame budget cannot pay for, which is what
 * made panning collapse while the track played.
 *
 * Changes made while playback is stopped — a scrub, reset, jump to end — are
 * published immediately. There is no following frame to carry them, and a
 * cursor that lags a deliberate action looks broken rather than smooth.
 */
export function useThrottledPlayhead(playhead: Playhead, playing: boolean): number {
  const [value, setValue] = useState(playhead.value)

  useEffect(() => {
    let frame = 0
    const unsubscribe = playhead.subscribe(t => {
      if (!playing) {
        if (frame) { cancelAnimationFrame(frame); frame = 0 }
        setValue(t)
        return
      }
      if (frame) return
      // Reads the playhead again on the way out rather than closing over `t`,
      // so a frame that coalesced several moves publishes the latest.
      frame = requestAnimationFrame(() => { frame = 0; setValue(playhead.value) })
    })
    return () => { unsubscribe(); if (frame) cancelAnimationFrame(frame) }
  }, [playhead, playing])

  return value
}
