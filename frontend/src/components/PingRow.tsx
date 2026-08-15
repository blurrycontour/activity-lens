import { useEffect, useState } from 'react'
import { Armchair, Check, Hand } from 'lucide-react'
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
export default function PingRow({ userId, name, info }: {
  userId: number
  /** Who is being nudged, for the button labels. */
  name: string
  info: PingInfo
}) {
  /** Seconds until another ping may be sent; 0 means now. */
  const [wait, setWait] = useState(info.waitSeconds)
  const [busy, setBusy] = useState<string | null>(null)
  /** Which one was just sent, and so wears the tick until the wait is over. */
  const [sent, setSent] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Seeded from the server on every load of the profile, so a cooldown started
  // on another device is honoured here rather than discovered by a rejection.
  // Which ping that was is not worth carrying across a reload — the tick says
  // "this is what you just sent", and by then you have been somewhere else.
  useEffect(() => { setWait(info.waitSeconds) }, [info.waitSeconds])

  // One timer for the life of the row rather than one per cooldown. Setting the
  // same zero back is a no-op React drops, so an idle row does not re-render
  // once a second, and there is no interval to start, clear and restart as the
  // countdown crosses zero.
  useEffect(() => {
    const t = setInterval(() => setWait(w => (w > 0 ? w - 1 : 0)), 1000)
    return () => clearInterval(t)
  }, [])

  // The tick belongs to the cooldown, so it clears itself with it rather than
  // needing a second timer that could disagree about when it is over.
  useEffect(() => { if (wait <= 0) setSent(null) }, [wait])

  async function send(id: string) {
    setBusy(id); setErr(null)
    try {
      const res = await api.pingUser(userId, id)
      setSent(id)
      setWait(res.cooldownSeconds)
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
          const done = sent === m.id
          return (
            <button
              key={m.id}
              type="button"
              className={`ping-btn${done ? ' sent' : ''}`}
              disabled={wait > 0 || busy !== null}
              onClick={() => void send(m.id)}
              title={m.text}
              aria-label={`${m.text} — send to ${name}`}
            >
              {done
                ? <Check size={18} aria-hidden />
                : sport
                  ? <TypeIcon type={sport} size={18} />
                  : m.id === 'couch'
                    ? <Armchair size={18} aria-hidden />
                    : <Hand size={18} aria-hidden />}
            </button>
          )
        })}
      </div>
      {/* The only text, and only when something went wrong. */}
      {err && <span className="ping-err">{err}</span>}
    </div>
  )
}
