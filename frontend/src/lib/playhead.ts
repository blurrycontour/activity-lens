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
 * The one number that decides how the two halves of playback share the main
 * thread. Every publish re-renders the charts; the map marker does not go
 * through React at all, so it keeps 60fps regardless. Raising the rate buys a
 * smoother chart cursor directly at the map's expense.
 *
 * 100ms is the rate the map was measured smooth at. The charts cost roughly an
 * order of magnitude less per publish than they used to — see downsample.ts and
 * hrZoneCounter — so there is headroom to trade some of it back if the cursor is
 * worth it, but that is a trade to make deliberately and check, not to assume.
 */
const PUBLISH_MS = 100

/**
 * A React state copy of the playhead, published at a rate a chart can afford.
 *
 * Publishing on every animation frame instead — which this briefly did — reads
 * like the obvious answer and is not. requestAnimationFrame has no backpressure
 * that favours anyone: the browser keeps firing it at display rate however long
 * the callbacks take, so a render that overruns the frame budget does not slow
 * the publishing down, it just leaves no time for MapLibre to draw. The map
 * stutters under a pan while the charts stay perfectly smooth, which is exactly
 * backwards.
 *
 * So the rate is bounded by a clock, and rAF is used only to align the publish
 * that is due with a frame boundary.
 *
 * Changes made while playback is stopped — a scrub, reset, jump to end — are
 * published immediately. There is no following frame to carry them, and a
 * cursor that lags a deliberate action looks broken rather than smooth.
 */
export function useThrottledPlayhead(playhead: Playhead, playing: boolean): number {
  const [value, setValue] = useState(playhead.value)

  useEffect(() => {
    let last = 0
    let frame = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const cancel = () => {
      if (frame) { cancelAnimationFrame(frame); frame = 0 }
      if (timer) { clearTimeout(timer); timer = undefined }
    }
    // Reads the playhead on the way out rather than closing over the value that
    // scheduled this, so a publish that coalesced several moves carries the
    // latest one.
    const publish = () => {
      frame = 0
      last = performance.now()
      setValue(playhead.value)
    }

    const unsubscribe = playhead.subscribe(t => {
      if (!playing) {
        cancel()
        last = performance.now()
        setValue(t)
        return
      }
      if (frame || timer) return
      const due = PUBLISH_MS - (performance.now() - last)
      if (due <= 0) {
        frame = requestAnimationFrame(publish)
        return
      }
      // Trailing edge, so the last moment before a pause is not left
      // unpublished and the charts do not stop short of where the marker is.
      timer = setTimeout(() => { timer = undefined; frame = requestAnimationFrame(publish) }, due)
    })

    return () => { unsubscribe(); cancel() }
  }, [playhead, playing])

  return value
}
