import { useSyncExternalStore } from 'react'

/**
 * A value that changes whenever the theme or the accent does.
 *
 * Most of the app reads its colours as `var(--…)` and needs nothing: the
 * browser repaints when the token changes and React never hears about it. But
 * a few places have to resolve a token to a literal — SVG `fill` attributes
 * handed to Recharts, paint properties handed to MapLibre, a canvas — and
 * those read the value once, during a render, and keep whatever they got.
 *
 * That is why the Weekly Trend chart kept the dark theme's bars after
 * switching to light: nothing on the dashboard re-rendered, so nothing
 * recomputed the ramp. Depending on this hook makes a theme change a real
 * dependency change.
 *
 * Watching the document rather than subscribing to a context, because that is
 * where both signals actually land — App sets the theme as a class on <html>
 * and the accent as inline custom properties on the same element — and because
 * a component that resolves tokens should not have to be wired to whichever
 * provider happens to own the setting this week.
 */
export function useThemeTokens(): number {
  return useSyncExternalStore(subscribe, () => version, () => 0)
}

let version = 0
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  observer ??= start()
  return () => {
    listeners.delete(onChange)
    // The observer is left running. It is one MutationObserver on one element
    // watching two attributes, which costs nothing, and tearing it down and
    // rebuilding it as components mount and unmount would cost more.
  }
}

let observer: MutationObserver | null = null

function start(): MutationObserver {
  const mo = new MutationObserver(() => {
    version++
    for (const l of listeners) l()
  })
  // `class` is the theme, `style` is the accent's custom properties. Nothing
  // else on <html> changes often enough for the extra callbacks to matter.
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
  return mo
}
