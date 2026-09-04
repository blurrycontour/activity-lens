// Accent color palette and applier shared across the app.
import { setNativeAccent } from './native/shell'

export const ACCENTS: { name: string; value: string; dim: string; glow: string }[] = [
  { name: 'Electric Green',   value: '#00e87a', dim: 'rgba(0,232,122,0.15)', glow: 'rgba(0,232,122,0.3)' },
  { name: 'Cobalt Blue',      value: '#3b82f6', dim: 'rgba(59,130,246,0.15)', glow: 'rgba(59,130,246,0.3)' },
  /* Not #f59e0b: that is the exact hex of --warning, and nothing within about
     30° of true amber clears the palette test's 20 ΔE floor against it — an
     amber accent and the warning colour would read as the same hue. Marigold
     is the nearest gold that actually stays apart from it. */
  { name: 'Blazing Marigold', value: '#f3d124', dim: 'rgba(243,209,36,0.15)', glow: 'rgba(243,209,36,0.3)' },
  { name: 'Deep Violet',      value: '#a855f7', dim: 'rgba(168,85,247,0.15)', glow: 'rgba(168,85,247,0.3)' },
  { name: 'Bright Cyan',      value: '#06b6d4', dim: 'rgba(6,182,212,0.15)',  glow: 'rgba(6,182,212,0.3)'  },
  /* Lifted off #f43f5e, which sat 14.7 ΔE from --danger — close enough that on
     Rose a delete button and the accent were the same colour, and the one thing
     the status palette exists to keep separate was not. */
  { name: 'Bold Rose',        value: '#fb7185', dim: 'rgba(251,113,133,0.15)', glow: 'rgba(251,113,133,0.3)' },
]

export function applyAccent(value: string) {
  const a = ACCENTS.find(a => a.value === value) || ACCENTS[0]
  const root = document.documentElement
  root.style.setProperty('--primary', a.value)
  root.style.setProperty('--primary-dim', a.dim)
  root.style.setProperty('--primary-glow', a.glow)
  /*
   * And the parts of the app that are not the web page.
   *
   * On Android the notifications, their glyphs and the session ring are drawn
   * by native code from a colour compiled into the app, so someone on Rose had
   * a green notification shade — the one part of the app that never got the
   * message. Sent on every apply rather than only on a change: this also runs
   * at startup, which is what keeps the two in step after an app update or a
   * reinstall, and it is a no-op off the phone.
   */
  void setNativeAccent(a.value)
}


/**
 * Display preferences that sit alongside the theme rather than inside it.
 *
 * Dark and light each had exactly one background, so the only thing anyone
 * could adjust was the hue of the highlights — while the things that actually
 * vary with how a training app gets used, glare and ambient light and a phone
 * held at arm's length mid-set, were fixed. These are switches rather than
 * extra entries in the theme list precisely so they compose: high contrast on
 * light is the outdoor case, pure black on dark is the 6am one, and picking
 * either from a single list would have cost the system-follows behaviour.
 */
export const PURE_BLACK_KEY = 'al_pure_black'
export const HIGH_CONTRAST_KEY = 'al_high_contrast'

export interface DisplayPrefs {
  /** True black surfaces in dark mode. No effect in light. */
  pureBlack: boolean
  /** Stronger text and lines, in both themes. */
  highContrast: boolean
}

export function readDisplayPrefs(): DisplayPrefs {
  return {
    pureBlack: localStorage.getItem(PURE_BLACK_KEY) === '1',
    highContrast: localStorage.getItem(HIGH_CONTRAST_KEY) === '1',
  }
}

/**
 * Reflected as attributes on :root rather than as classes, so the theme's own
 * `.light` class stays the single thing that says which theme is on and these
 * two can be selected against it without a combinatorial explosion of names.
 */
export function applyDisplayPrefs({ pureBlack, highContrast }: DisplayPrefs) {
  const root = document.documentElement
  root.toggleAttribute('data-pure-black', pureBlack)
  root.toggleAttribute('data-high-contrast', highContrast)
}

/** The page background for a resolved theme, honouring pure black. */
export function backgroundFor(theme: 'dark' | 'light', pureBlack: boolean): string {
  if (theme === 'light') return '#f4f6f9'
  return pureBlack ? '#000000' : '#0a0b0e'
}
