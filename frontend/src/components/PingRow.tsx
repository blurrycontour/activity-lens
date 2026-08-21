import { useEffect, useRef, useState } from 'react'
import { Armchair, Check, Hand } from 'lucide-react'
import { api, ApiError, type PingInfo } from '../lib/api'
import type { WorkoutType } from '../data/workouts'
import { useLongPress } from '../lib/useLongPress'
import Toast from './Toast'
import TypeIcon from './TypeIcon'

/**
 * Which sport a ping id stands for, so the row wears the same marks and colours
 * as everything else in the app.
 *
 * A lookup rather than a cast, because the ids come from the server: one it
 * offers that this build has never heard of still draws — as a plain hand —
 * instead of rendering an icon for a sport that does not exist.
 */
const SPORT: Record<string, WorkoutType> = {
  run: 'Run', ride: 'Ride', hike: 'Hike', swim: 'Swim', strength: 'Strength',
}

/**
 * A row of nudges to send someone, under their name.
 *
 * The message is the icon: there is nothing to type, which is what keeps a ping
 * from being a messaging feature with a moderation problem attached. The server
 * owns the words — this only ever sends back an id it was given, and the text
 * it hands out is what the button says when you rest on it.
 *
 * There is no confirmation line. The one that was here restated something the
 * row already showed, and a sentence appearing under a set of buttons is a page
 * that moves every time you use it. The tick in the icon you pressed is the
 * receipt, and it stays there for as long as the cooldown does — so what was
 * sent, and that nothing more can be sent yet, are one mark rather than two.
 */
/**
 * When a wait of this many seconds is up.
 *
 * With a moment's grace on the end. The server is measuring the same cooldown
 * from a slightly earlier instant — it started counting when the request
 * arrived, and this starts when the answer got back — so a row that re-enabled
 * itself the instant its own arithmetic said zero could still be a few
 * milliseconds early, and be refused for them.
 */
const GRACE_MS = 400

function deadline(seconds: number): number {
  return seconds > 0 ? Date.now() + seconds * 1000 + GRACE_MS : 0
}

export default function PingRow({ userId, name, info }: {
  userId: number
  /** Who is being nudged, for the button labels. */
  name: string
  info: PingInfo
}) {
  /**
   * When another ping may be sent, in epoch milliseconds; 0 means now.
   *
   * A deadline rather than a count of seconds ticked down. A counter is only
   * ever as accurate as the moment its interval happens to fire: the timer runs
   * for the life of the row, so the first tick after a send lands somewhere in
   * the next second and takes a whole one off a cooldown that has barely
   * started. The row then re-enabled itself up to a second before the server
   * would accept anything, and pressing in that window earned a rejection
   * saying to wait — which is exactly what the row had just stopped saying.
   * A deadline cannot drift, whatever the interval does.
   */
  const [until, setUntil] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  /** Which one was just sent, and so wears the tick until the wait is over. */
  const [sent, setSent] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  /** The "sent" toast, held as text so the same one cannot show twice. */
  const [toast, setToast] = useState<string | null>(null)
  /** Which message is showing its full text, from a press and hold. */
  const [tip, setTip] = useState<string | null>(null)
  /** Ticked once a second purely to re-read the clock above. */
  const [, tick] = useState(0)

  // Seeded from the server on every load of the profile, so a cooldown started
  // on another device is honoured here rather than discovered by a rejection.
  // Which ping that was is not worth carrying across a reload — the tick says
  // "this is what you just sent", and by then you have been somewhere else.
  useEffect(() => { setUntil(deadline(info.waitSeconds)) }, [info.waitSeconds])

  // One timer for the life of the row rather than one per cooldown: there is
  // no interval to start, clear and restart as the countdown crosses zero, and
  // nothing it does can move the deadline it is reading.
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  // Rounded up, so a wait is over only once it is actually over.
  const wait = Math.max(0, Math.ceil((until - Date.now()) / 1000))

  // The tick belongs to the cooldown, so it clears itself with it rather than
  // needing a second timer that could disagree about when it is over.
  useEffect(() => { if (wait <= 0) setSent(null) }, [wait])

  async function send(id: string) {
    setBusy(id); setErr(null)
    try {
      const res = await api.pingUser(userId, id)
      setSent(id)
      setUntil(deadline(res.cooldownSeconds))
      setToast(`Sent to ${name}`)
    } catch (e) {
      // A 429 means another device got there first, so the cooldown is running
      // whatever this one believed. Starting it here keeps the row honest
      // rather than letting it offer a button that will only be refused again.
      if (e instanceof ApiError && e.status === 429) setUntil(deadline(info.cooldownSeconds))
      setErr(e instanceof ApiError ? e.message : 'Could not send that')
    } finally { setBusy(null) }
  }

  const tipText = info.messages.find(m => m.id === tip)?.text ?? null

  return (
    <div className="ping-row">
      <div className="ping-buttons">
        {info.messages.map(m => (
          <PingButton
            key={m.id}
            message={m}
            name={name}
            sent={sent === m.id}
            disabled={wait > 0 || busy !== null}
            /* The ring runs for as long as the wait actually does, grace
               and all, so it empties as the button comes back rather than a
               moment before it. */
            cooldown={info.cooldownSeconds + GRACE_MS / 1000}
            showTip={tip === m.id}
            onTip={open => setTip(open ? m.id : null)}
            onSend={() => void send(m.id)}
          />
        ))}
      </div>
      {/* The held text, centred over the whole row rather than over the icon
          it belongs to. Anchored to a button, the tip for the first or last
          one ran off the side of a phone; anchored to the row — which is as
          wide as the page — it cannot, and it is still directly above the
          finger holding it. */}
      {tipText && <span className="ping-tip" role="status">{tipText}</span>}
      {/* The only text, and only when something went wrong. */}
      {err && <span className="ping-err">{err}</span>}
      {toast && (
        <Toast
          message={toast}
          icon={<Check size={15} aria-hidden />}
          onDone={() => setToast(null)}
        />
      )}
    </div>
  )
}

/**
 * One nudge: press to send it, hold to read it.
 *
 * Its own component because it carries a gesture and two pieces of state that
 * are nobody else's business. The hold is the answer to a row of six wordless
 * circles — the icons say which sport, and holding one says exactly what the
 * other person will read, which is the part you cannot guess from a bicycle.
 */
function PingButton({ message: m, name, sent, disabled, cooldown, showTip, onTip, onSend }: {
  message: { id: string; text: string }
  name: string
  sent: boolean
  disabled: boolean
  /** How long the wait it just started is, in seconds — the ring's duration. */
  cooldown: number
  showTip: boolean
  onTip: (open: boolean) => void
  onSend: () => void
}) {
  const press = useLongPress(() => onTip(true))
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null)
  /*
   * The callback through a ref.
   *
   * The parent re-renders once a second while a cooldown runs and hands down a
   * fresh arrow each time, so an effect depending on it re-runs every second —
   * which restarts the auto-hide timer every second, and it never fires. Same
   * trap the toast fell into.
   */
  const tipRef = useRef(onTip)
  tipRef.current = onTip

  /*
   * The tip closes on the next touch anywhere, and on its own if there is
   * none.
   *
   * Both are needed. The gesture that opened it has no matching "un-hold" on a
   * phone — a finger lifts and nothing else happens — so without the timeout it
   * would sit there; and without the outside tap, dismissing it meant waiting
   * out a timer while the thing you actually pressed did nothing.
   *
   * Listening on pointerdown in the capture phase, so the tap that dismisses is
   * seen before anything under it decides what to do about it.
   */
  useEffect(() => {
    if (!showTip) return
    const close = () => tipRef.current(false)
    hide.current = setTimeout(close, 2200)
    // Deferred a tick: the pointerdown that *opened* this is still being
    // dispatched, and a listener added during it would catch the same event
    // and close the tip before it was ever seen.
    const armed = setTimeout(() => {
      document.addEventListener('pointerdown', close, true)
      window.addEventListener('scroll', close, true)
    }, 0)
    return () => {
      if (hide.current) clearTimeout(hide.current)
      clearTimeout(armed)
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('scroll', close, true)
    }
  }, [showTip])

  const sport = SPORT[m.id]
  return (
    <span className="ping-slot">
      <button
        type="button"
        className={`ping-btn${sent ? ' sent' : ''}`}
        disabled={disabled}
        onClick={() => { if (!press.consumedClick()) onSend() }}
        {...press.handlers}
        title={m.text}
        aria-label={`${m.text} — send to ${name}`}
      >
        {sent
          ? <Check size={18} aria-hidden />
          : sport
            ? <TypeIcon type={sport} size={18} />
            : m.id === 'couch'
              ? <Armchair size={18} aria-hidden />
              : <Hand size={18} aria-hidden />}
        {/* The cooldown, drawn around the tick: the row already says "you
            cannot send another one yet" by being disabled, and this says how
            much longer without a number nobody would watch. Stroked from the
            top and clockwise, and it empties as the wait runs out.

            Emptied by one CSS animation of exactly the cooldown's length,
            started when the ring appears, rather than by a value re-set every
            second. A per-second value has to be animated to look like a clock
            and then permanently disagrees with one by however long that
            animation takes — it either lagged a second behind or, corrected,
            started a second short. An animation is simply the right length. */}
        {sent && cooldown > 0 && (
          <svg className="ping-ring" viewBox="0 0 40 40" aria-hidden>
            <circle
              cx="20" cy="20" r="18"
              pathLength={100}
              strokeDasharray="100"
              style={{ animationDuration: `${cooldown}s` }}
            />
          </svg>
        )}
      </button>
    </span>
  )
}
