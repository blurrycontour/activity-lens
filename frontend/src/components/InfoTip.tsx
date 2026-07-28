import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info } from 'lucide-react'

/** Gap between the trigger and the bubble, and the minimum viewport margin. */
const GAP = 8
const EDGE = 8

interface Position { top: number; left: number; width: number }

/**
 * Small "i" button next to a chart title that reveals a longer explanation.
 *
 * The bubble is rendered into a portal and positioned with fixed coordinates
 * clamped to the viewport. Positioning it relative to the trigger instead would
 * let it be clipped by the scrolling chart cards it lives inside, and would run
 * off the screen edge for any tip near the right-hand side on a phone.
 *
 * Opening is hover-driven for mouse users and tap-driven for everyone else.
 * Doing both unconditionally is why it used to need two taps: touch browsers
 * synthesise a mouseenter that opened it, and the click that followed
 * immediately toggled it back shut.
 */
export default function InfoTip({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Position | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const pointerType = useRef<string>('mouse')

  const place = useCallback(() => {
    const trigger = triggerRef.current
    const bubble = bubbleRef.current
    if (!trigger || !bubble) return
    const t = trigger.getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = document.documentElement.clientHeight
    const width = Math.min(bubble.offsetWidth, vw - EDGE * 2)
    const height = bubble.offsetHeight

    // Centre on the trigger, then pull back inside the viewport.
    let left = t.left + t.width / 2 - width / 2
    left = Math.max(EDGE, Math.min(left, vw - width - EDGE))

    // Below the trigger when there's room, above it otherwise.
    const below = t.bottom + GAP
    const top = below + height <= vh - EDGE ? below : Math.max(EDGE, t.top - GAP - height)

    setPos({ top, left, width })
  }, [])

  // Measured and positioned before the browser paints, so the bubble is never
  // visible in the wrong place first.
  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    function away(e: Event) {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (bubbleRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    function esc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('touchstart', away)
    document.addEventListener('keydown', esc)
    // Any scroll or resize invalidates the fixed coordinates; closing is less
    // jarring than chasing the trigger around.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('touchstart', away)
      document.removeEventListener('keydown', esc)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="infotip-trigger"
        aria-label={label ? `About ${label}` : 'More information'}
        aria-expanded={open}
        onPointerDown={e => { pointerType.current = e.pointerType }}
        onPointerEnter={e => { if (e.pointerType === 'mouse') setOpen(true) }}
        onPointerLeave={e => { if (e.pointerType === 'mouse') setOpen(false) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={e => {
          e.stopPropagation()
          // Mouse users already have hover; only touch and keyboard toggle.
          if (pointerType.current !== 'mouse') setOpen(o => !o)
        }}
      >
        <Info size={13} />
      </button>
      {open && createPortal(
        <div
          ref={bubbleRef}
          className="infotip-bubble"
          role="tooltip"
          style={pos
            ? { top: pos.top, left: pos.left, width: pos.width }
            // First render is off-screen so it can be measured at its natural
            // width without ever being seen at the wrong coordinates.
            : { top: 0, left: -9999, visibility: 'hidden' }}
        >
          {text}
        </div>,
        document.body,
      )}
    </>
  )
}
