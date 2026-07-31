import { useEffect, useState } from 'react'
import { ApiError } from '../lib/api'
import {
  disableNativePush, enableNativePush, listDistributors, nativePushStatus,
  NOTIFICATIONS_DENIED, type Distributor, type NativePushStatus,
} from '../lib/native/unifiedPush'
import Field from './Field'
import Dropdown from './Dropdown'

interface NativePushCardProps {
  /** The account's master push preference, shared with the web toggle. */
  pushPref: boolean
  /** Saves that preference. Called before enrolling, so the two cannot disagree. */
  onPushPrefChange: (on: boolean) => Promise<void>
}

/**
 * The push enrolment control in the Android app.
 *
 * The web app enrols through the browser's own push service; the app cannot,
 * because that service is Google's and half the point of a self-hosted training
 * log is running without it. Android's answer is UnifiedPush: a *distributor*
 * app already on the phone — ntfy, most commonly — hands out a URL, and the
 * server posts notifications to it. No Play Services anywhere in the path, which
 * is what makes this work on GrapheneOS.
 *
 * The cost is that it needs a second app installed, so the state where none is
 * present is the first thing this handles rather than an afterthought: a switch
 * that silently does nothing would be worse than an explanation.
 */
export default function NativePushCard({ pushPref, onPushPrefChange }: NativePushCardProps) {
  const [status, setStatus] = useState<NativePushStatus | null>(null)
  const [distributors, setDistributors] = useState<Distributor[]>([])
  const [chosen, setChosen] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const [s, d] = await Promise.all([nativePushStatus(), listDistributors()])
      if (!active) return
      setStatus(s)
      setDistributors(d)
      // Whatever is already registered, else the only choice, else nothing —
      // preselecting the sole distributor saves a pointless decision.
      setChosen(s.distributor ?? (d.length > 0 ? d[0].packageName : ''))
    })()
    return () => { active = false }
  }, [])

  const registered = Boolean(status?.endpoint)
  const on = registered && pushPref

  async function toggle(next: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      // The preference is saved first either way: it is what decides whether the
      // server pushes at all, and an enrolled device with the preference off
      // would be a switch that looks on and delivers nothing.
      await onPushPrefChange(next)
      if (next) {
        await enableNativePush(chosen)
        setMsg({ ok: true, text: 'This device will now receive notifications.' })
      } else {
        await disableNativePush()
      }
      setStatus(await nativePushStatus())
    } catch (e) {
      const text = e instanceof Error && e.message === NOTIFICATIONS_DENIED
        ? 'Android is blocking notifications for Activity Lens. Allow them in the system app settings, then try again.'
        : e instanceof ApiError || e instanceof Error
          ? e.message
          : 'Could not change push notifications'
      setMsg({ ok: false, text })
      setStatus(await nativePushStatus())
    } finally {
      setBusy(false)
    }
  }

  if (status && !status.available) {
    return (
      <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Push Notifications</div>
        <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
          Needs a push distributor app, which Activity Lens does not bundle. Install one —{' '}
          <strong>ntfy</strong> is the usual choice and works with your own ntfy server — then
          come back here. This is how the app delivers notifications without Google Play Services.
        </p>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
      <label className="switch" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
        <input
          type="checkbox"
          checked={on}
          disabled={busy || !status || !chosen}
          onChange={e => void toggle(e.target.checked)}
        />
        <span className="switch-track" />
        Push Notifications
      </label>

      {distributors.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <Field label="Distributor">
            <div style={{ maxWidth: 220 }}>
              <Dropdown
                block
                value={chosen}
                options={distributors.map(d => ({ value: d.packageName, label: d.label }))}
                /* Locked while enrolled: switching means giving the endpoint back
                   and asking the other distributor for a new one, so it is a
                   deliberate off-then-on rather than something a stray tap can do. */
                disabled={busy || on}
                onChange={setChosen}
                ariaLabel="Push distributor"
              />
            </div>
          </Field>
        </div>
      )}

      <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
        Reaches you even when Activity Lens is closed, delivered through the distributor app on
        this phone rather than Google. This is per device, so turn it on anywhere you want to be
        notified. The distributor can read the notification's title and text — with your own ntfy
        server that is the same trust as the server itself.
      </p>

      {msg && (
        <p style={{ fontSize: 12, marginTop: 10, color: msg.ok ? 'var(--primary)' : 'var(--danger)' }}>{msg.text}</p>
      )}
    </div>
  )
}
