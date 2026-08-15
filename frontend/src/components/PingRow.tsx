import { useEffect, useState } from 'react'
import { Armchair, Hand, MessageCircle, X } from 'lucide-react'
import { api, ApiError, type PingInfo } from '../lib/api'
import type { WorkoutType } from '../data/workouts'
import useDismissOnBack from '../lib/useDismissOnBack'
import Modal from './Modal'
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

/** The mark for one ping, sports in their own colour and the couch in ink. */
function PingIcon({ id, size = 18 }: { id: string; size?: number }) {
  const sport = SPORT[id]
  if (sport) return <TypeIcon type={sport} size={size} />
  if (id === 'couch') return <Armchair size={size} aria-hidden />
  return <Hand size={size} aria-hidden />
}

/** How the countdown reads while it runs. */
function countdown(secs: number): string {
  if (secs >= 60) return `${Math.ceil(secs / 60)}m`
  return `${secs}s`
}

/**
 * Nudging someone, from their profile header.
 *
 * One button that opens the list rather than the list itself: the nudges are a
 * thing you do to the person in the header, so they belong beside them, and six
 * icons sitting permanently under a profile made a rare action look like the
 * page's main business. The label collapses to the icon on a phone, where the
 * header is already carrying an avatar, a name, a handle and a tagline.
 *
 * The message is the icon — there is nothing to type, which is what keeps this
 * from being a messaging feature with a moderation problem attached. The server
 * owns the words; this only ever sends back an id it was given.
 */
export default function PingRow({ userId, name, info }: {
  userId: number
  /** Who is being nudged, for the labels and the status line. */
  name: string
  info: PingInfo
}) {
  const [open, setOpen] = useState(false)
  /** Seconds until another ping may be sent; 0 means now. */
  const [wait, setWait] = useState(info.waitSeconds)
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Seeded from the server on every load of the profile, so a cooldown started
  // on another device is honoured here rather than discovered by a rejection.
  useEffect(() => { setWait(info.waitSeconds) }, [info.waitSeconds])

  // One timer for the life of the component rather than one per cooldown.
  // Setting the same zero back is a no-op React drops, so an idle profile does
  // not re-render once a second, and there is no interval to start, clear and
  // restart as the countdown crosses zero.
  useEffect(() => {
    const t = setInterval(() => setWait(w => (w > 0 ? w - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [])

  useDismissOnBack(open, () => setOpen(false))

  async function send(id: string, text: string) {
    setBusy(id); setErr(null); setSent(null)
    try {
      const res = await api.pingUser(userId, id)
      setWait(res.cooldownSeconds)
      setSent(text)
    } catch (e) {
      // A 429 means another device got there first, so the cooldown is running
      // whatever this one believed. Starting it here keeps the dialog honest
      // rather than letting it offer a button that will only be refused again.
      if (e instanceof ApiError && e.status === 429) setWait(info.cooldownSeconds)
      setErr(e instanceof ApiError ? e.message : 'Could not send that')
    } finally { setBusy(null) }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost ping-open"
        onClick={() => { setOpen(true); setSent(null); setErr(null) }}
        title={`Ping ${name}`}
        aria-label={`Ping ${name}`}
      >
        <MessageCircle size={15} />
        {/* Hidden by CSS rather than by a width hook: this is a label appearing
            and disappearing with the viewport, and a JS breakpoint would make
            it flicker on first paint. */}
        <span className="ping-open-label">Ping</span>
      </button>

      {open && (
        <Modal onClose={() => setOpen(false)} label={`Ping ${name}`}>
          <div className="modal-box" style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <h3 style={{ fontSize: 16, fontWeight: 700, flex: 1 }}>Ping {name}</h3>
              <button className="btn-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>

            <div className="ping-list">
              {info.messages.map(m => (
                <button
                  key={m.id}
                  type="button"
                  className="ping-item"
                  disabled={wait > 0 || busy !== null}
                  onClick={() => void send(m.id, m.text)}
                >
                  <PingIcon id={m.id} />
                  <span>{m.text}</span>
                </button>
              ))}
            </div>

            {/* One line, three states, so the dialog never grows or shrinks as
                it is used: what was sent, why it was refused, or the wait. */}
            <span className={`ping-status${err ? ' err' : ''}`}>
              {err ?? (sent
                ? `Sent to ${name}`
                : wait > 0
                  ? `You can ping ${name} again in ${countdown(wait)}`
                  : 'They get a notification with your picture.')}
            </span>
          </div>
        </Modal>
      )}
    </>
  )
}
