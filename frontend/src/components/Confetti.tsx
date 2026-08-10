import { useEffect, useRef } from 'react'

/** How long pieces keep falling before the canvas gives up and unmounts. */
const DURATION_MS = 4000
const PIECE_COUNT = 140

/**
 * A burst of falling confetti, for the moment every goal is met.
 *
 * Hand-rolled on a canvas rather than pulled in as a dependency: it is sixty
 * lines and one animation frame loop, against a package that would ship its own
 * physics engine for the same four seconds a year.
 *
 * Colours are read from the document, so the rain follows the user's accent
 * instead of being the one hardcoded palette in the app. Nothing renders at all
 * under `prefers-reduced-motion` — a screenful of moving objects is exactly what
 * that setting is asking not to see, and there is nothing to fall back to
 * because the celebration is not carrying any information.
 */
export default function Confetti({ onDone }: { onDone?: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  // In a ref, not a dep: the callback identity must not restart the animation.
  const done = useRef(onDone)
  done.current = onDone

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      done.current?.()
      return
    }
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    let width = 0
    let height = 0
    const resize = () => {
      width = canvas.clientWidth
      height = canvas.clientHeight
      canvas.width = width * dpr
      canvas.height = height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const styles = getComputedStyle(document.documentElement)
    const palette = ['--primary', '--blue', '--purple', '--accent', '--success']
      .map(name => styles.getPropertyValue(name).trim())
      .filter(Boolean)
    const colors = palette.length > 0 ? palette : ['#00e87a']

    const pieces = Array.from({ length: PIECE_COUNT }, () => ({
      x: Math.random() * width,
      // Staggered above the top edge, so they arrive as a shower rather than a
      // single line dropping in unison.
      y: -20 - Math.random() * height,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      vy: 40 + Math.random() * 120,
      drift: (Math.random() - 0.5) * 60,
      spin: (Math.random() - 0.5) * 6,
      angle: Math.random() * Math.PI * 2,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))

    let frame = 0
    let last = performance.now()
    const started = last

    const tick = (now: number) => {
      // Real elapsed time, so the fall looks the same on a 60 Hz laptop and a
      // 120 Hz phone, and a backgrounded tab does not resume mid-air.
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      const elapsed = now - started
      // Fade the whole thing out over the last second rather than cutting.
      const fade = Math.max(0, Math.min(1, (DURATION_MS - elapsed) / 1000))

      ctx.clearRect(0, 0, width, height)
      ctx.globalAlpha = fade
      for (const p of pieces) {
        p.y += p.vy * dt
        p.x += p.drift * dt
        p.angle += p.spin * dt
        if (p.y > height + 20) {
          p.y = -20
          p.x = Math.random() * width
        }
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      ctx.globalAlpha = 1

      if (elapsed < DURATION_MS) frame = requestAnimationFrame(tick)
      else done.current?.()
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={ref} className="confetti" aria-hidden="true" />
}
