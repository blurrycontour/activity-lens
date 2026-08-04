import { useEffect, useState } from 'react'
import { usePreferences } from '../../context/PreferencesContext'
import { useAuth } from '../../context/AuthContext'
import { api, ApiError, type NotificationKind, type NotifyPrefs } from '../../lib/api'
import { enablePush, disablePush, pushState as pushState_, type PushState } from '../../lib/push'
import { isNative } from '../../lib/serverConfig'
import NativePushCard from '../../components/NativePushCard'
import SettingsCard from '../../components/SettingsCard'
import StatusMsg, { type Msg } from '../../components/StatusMsg'

/**
 * The switches this page offers, in the order they are listed.
 *
 * `adminOnly` marks a kind the server only ever sends to administrators.
 * Showing it to everyone else would offer a switch that can never fire, which
 * reads as a broken feature rather than an inapplicable one.
 */
const NOTIFY_KINDS: { id: NotificationKind; label: string; adminOnly?: boolean }[] = [
  { id: 'workout_shared', label: 'Someone shares a workout with me' },
  { id: 'gear_worn', label: 'Gear reaches its replacement distance' },
  { id: 'goal_met', label: 'I complete a training goal' },
  { id: 'goal_at_risk', label: "A goal's period is nearly over and I'm short" },
  { id: 'workout_imported', label: 'Auto import brings in new workouts' },
  { id: 'feedback', label: 'A user sends feedback', adminOnly: true },
]

/** Everything on, matching the server's default for a user who never saved. */
const DEFAULT_NOTIFY: NotifyPrefs = {
  kinds: Object.fromEntries(NOTIFY_KINDS.map(k => [k.id, true])) as NotifyPrefs['kinds'],
  push: true,
}

export default function NotificationSettings() {
  const { prefs, save } = usePreferences()
  const { user } = useAuth()
  const [notify, setNotify] = useState<NotifyPrefs>(DEFAULT_NOTIFY)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [pushKey, setPushKey] = useState('')
  const [pushState, setPushState] = useState<PushState>('off')
  const [pushBusy, setPushBusy] = useState(false)

  useEffect(() => {
    if (prefs) setNotify(prefs.notify ?? DEFAULT_NOTIFY)
  }, [prefs])

  // The VAPID key rides along on the notifications endpoint rather than having
  // its own route, since this page already calls it.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [res, state] = await Promise.all([api.notifications(), pushState_()])
        if (!active) return
        setPushKey(res.pushKey ?? '')
        setPushState(res.pushKey ? state : 'unsupported')
      } catch { /* leave push showing as unavailable */ }
    })()
    return () => { active = false }
  }, [])

  async function saveNotify(next: NotifyPrefs) {
    setNotify(next)
    setMsg(null)
    try {
      await save({ notify: next })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    }
  }

  /** Enrols or removes this browser from push, reporting why if it refuses. */
  async function togglePush(on: boolean) {
    setPushBusy(true); setMsg(null)
    try {
      const state = on ? await enablePush(pushKey) : await disablePush()
      setPushState(state)
      if (state === 'denied') {
        setMsg({ ok: false, text: 'Your browser is blocking notifications. Allow them for this site, then try again.' })
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not change push notifications' })
    } finally { setPushBusy(false) }
  }

  return (
    <>
      {/* Delivery leads: whether notifications can reach you at all matters more
          than which ones, and the list below is moot without permission. */}
      {isNative() ? (
        <SettingsCard title="Push">
          <NativePushCard
            pushPref={notify.push}
            onPushPrefChange={on => saveNotify({ ...notify, push: on })}
          />
          <StatusMsg msg={msg} />
        </SettingsCard>
      ) : (
        <SettingsCard title="Push">
          {pushState === 'unsupported' ? (
            <span className="field-hint">
              Unavailable in this browser. On iPhone or iPad, add Activity Lens to your Home Screen
              first — Safari only allows push for installed apps.
            </span>
          ) : (
            <>
              <label className="switch" style={{ fontSize: 13, color: 'var(--text)' }}>
                <input
                  type="checkbox"
                  checked={pushState === 'on' && notify.push}
                  disabled={pushBusy || pushState === 'denied'}
                  onChange={async e => {
                    const on = e.target.checked
                    await saveNotify({ ...notify, push: on })
                    await togglePush(on)
                  }}
                />
                <span className="switch-track" />
                Reach me when the app is closed
              </label>
              <span className="field-hint">Per browser and per device — turn it on anywhere you want to be notified.</span>
            </>
          )}
          <StatusMsg msg={msg} />
        </SettingsCard>
      )}

      <SettingsCard title="Notify me when">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {NOTIFY_KINDS.filter(k => !k.adminOnly || user?.isAdmin).map(k => (
            <label className="switch" key={k.id} style={{ fontSize: 13, color: 'var(--text-2)' }}>
              <input
                type="checkbox"
                checked={notify.kinds[k.id] !== false}
                onChange={e => void saveNotify({ ...notify, kinds: { ...notify.kinds, [k.id]: e.target.checked } })}
              />
              <span className="switch-track" />
              {k.label}
            </label>
          ))}
        </div>
      </SettingsCard>
    </>
  )
}
