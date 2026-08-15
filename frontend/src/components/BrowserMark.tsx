/**
 * The mark for a browser, drawn rather than named.
 *
 * A session list is scanned, not read: "Chrome" and "Firefox" as words take the
 * same shape at a glance, where their marks do not. These are simplified glyphs
 * in the app's own line weight rather than the vendors' logos — a brand logo
 * dropped into a themed UI is the one element that cannot follow the accent or
 * the dark mode, and these sit beside text that does.
 *
 * `currentColor` throughout, so each one inherits whatever the row gives it.
 */

interface MarkProps {
  size?: number
}

/** Chrome: the three-lobed ring around a centre. */
function Chrome({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M21 8H12" />
      <path d="M4.2 7 8.7 14.4" />
      <path d="M15.4 14.4 10.9 21.9" />
    </svg>
  )
}

/** Firefox: a circle with the tail of the fox curling round it. */
function Firefox({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.5 9.5A9 9 0 1 1 15 3.6" />
      <path d="M12 3a6.5 6.5 0 0 1 6.4 5.4" />
      <path d="M4.6 12.6A5.5 5.5 0 0 0 15 14.4" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}

/** Safari: the compass rose. */
function Safari({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.8 8.2-2 5.6-5.6 2 2-5.6z" />
    </svg>
  )
}

/** Edge: a near-closed arc, the shape the logo reduces to. */
function Edge({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.6 13.5A8.8 8.8 0 0 0 4.2 9.6" />
      <path d="M3.6 12.4a8.8 8.8 0 0 0 13.7 7.2" />
      <path d="M4.2 9.6c2.2-1.6 9.1-2 16.4 3.9-4.6.9-9.9.6-13.4-1.6" />
    </svg>
  )
}

/** Opera: the O with its inner ellipse. */
function Opera({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="3.6" ry="7" />
    </svg>
  )
}

/** Anything else with a name we know but no mark of its own. */
function GenericBrowser({ size = 18 }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18" />
    </svg>
  )
}

/**
 * Picks the mark for a browser name.
 *
 * The name arrives as "Chrome 141", so this matches on the leading word.
 * Chromium-derived browsers each get their own, because the whole point is
 * telling two rows apart at a glance.
 */
export default function BrowserMark({ browser, size = 18 }: { browser?: string; size?: number }) {
  const name = (browser ?? '').toLowerCase()
  if (name.startsWith('chrome')) return <Chrome size={size} />
  if (name.startsWith('firefox')) return <Firefox size={size} />
  if (name.startsWith('safari')) return <Safari size={size} />
  if (name.startsWith('edge')) return <Edge size={size} />
  if (name.startsWith('opera')) return <Opera size={size} />
  return <GenericBrowser size={size} />
}
