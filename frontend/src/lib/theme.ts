// Accent color palette and applier shared across the app.
import { setNativeAccent } from './native/shell'

export const ACCENTS: { name: string; value: string; dim: string; glow: string }[] = [
  { name: 'Electric Green', value: '#00e87a', dim: 'rgba(0,232,122,0.15)', glow: 'rgba(0,232,122,0.3)' },
  { name: 'Electric Blue',  value: '#3b82f6', dim: 'rgba(59,130,246,0.15)', glow: 'rgba(59,130,246,0.3)' },
  { name: 'Vivid Orange',   value: '#ff6b35', dim: 'rgba(255,107,53,0.15)', glow: 'rgba(255,107,53,0.3)' },
  { name: 'Violet',         value: '#a855f7', dim: 'rgba(168,85,247,0.15)', glow: 'rgba(168,85,247,0.3)' },
  { name: 'Cyan',           value: '#06b6d4', dim: 'rgba(6,182,212,0.15)',  glow: 'rgba(6,182,212,0.3)'  },
  /* Lifted off #f43f5e, which sat 14.7 ΔE from --danger — close enough that on
     Rose a delete button and the accent were the same colour, and the one thing
     the status palette exists to keep separate was not. */
  { name: 'Rose',           value: '#fb7185', dim: 'rgba(251,113,133,0.15)', glow: 'rgba(251,113,133,0.3)' },
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
