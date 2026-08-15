import { useEffect, useState } from 'react'
import { Armchair, Hand } from 'lucide-react'
import { api, ApiError, type PingInfo } from '../lib/api'
import type { WorkoutType } from '../data/workouts'
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

/** How the countdown reads while it runs. */
function countdown(secs: number): string {
  if (secs >= 60) return `${Math.ceil(secs / 60)}m`
  return `${secs}s`
}

/**
 * A row of nudges to send someone, on their profile.
 *
 * The message is the icon: there is no text to type, which is what keeps a ping
 * from being a messaging feature with a moderation problem attached. The server
 * owns the words — this only ever sends back an id it was given.
 */
export default function PingRow({ userId, name, info }: {
  userId: number
  /** Who is being nudged, for the status line and the labels. */
  name: string
  info: PingInfo
}) {
  /** Seconds until another ping may be sent; 0 means now. */
  const [wait, setWait] = useState(info.waitSeconds)
  const [busy, setBusy] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Seeded from the server on every load of the profile, so a cooldown started
  // on another device is honoured here rather than discovered by a rejection.
  useEffect(() => { setWait(info.waitSeconds) }, [info.waitSeconds])

  // One timer for the life of the row rather than one per cooldown. Setting the
  // same zero back is a no-op React drops, so an idle row does not re-render
  // once a second — and there is no interval to start, clear and restart as the
  // countdown crosses zero.
  useEffect(() => {
    const t = setInterval(() => setWait(w => (w > 0 ? w - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [])

  async function send(id: string, text: string) {
    setBusy(id); setErr(null); setSent(null)
    try {
      const res = await api.pingUser(userId, id)
      setWait(res.cooldownSeconds)
      setSent(text)
    } catch (e) {
      // A 429 means another device got there first, so the cooldown is running
      // whatever this one believed. Starting it here keeps the row honest
      // rather than letting it offer a button that will only be refused again.
      if (e instanceof ApiError && e.status === 429) setWait(info.cooldownSeconds)
      setErr(e instanceof ApiError ? e.message : 'Could not send that')
    } finally { setBusy(null) }
  }

  return (
    <div className="ping-row">
      <div className="ping-buttons">
        {info.messages.map(m => {
          const sport = SPORT[m.id]
          return (
            <button
              key={m.id}
              type="button"
              className="ping-btn"
              disabled={wait > 0 || busy !== null}
              onClick={() => void send(m.id, m.text)}
              title={m.text}
              aria-label={`${m.text} — send to ${name}`}
            >
              {sport
                ? <TypeIcon type={sport} size={18} />
                : m.id === 'couch'
                  ? <Armchair size={18} />
                  : <Hand size={18} />}
            </button>
          )
        })}
      </div>
      {/* One line, three states, so the row never grows or shrinks as it is
          used: what was sent, why it was refused, or how long is left. */}
      <span className={`ping-status${err ? ' err' : ''}`}>
        {err ?? (sent
          ? `Sent: ${sent}`
          : wait > 0
            ? `You can ping ${name} again in ${countdown(wait)}`
            : `Send ${name} a nudge`)}
      </span>
    </div>
  )
}
