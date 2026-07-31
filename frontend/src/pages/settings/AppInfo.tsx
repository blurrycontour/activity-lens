import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import {
  canSelfUpdate, installedApp, requestUpdateCheck,
  UPDATE_CHECK_DONE_EVENT, type UpdateCheckResult,
} from '../../lib/native/appUpdate'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'

/**
 * How long to keep spinning before giving up on hearing a result.
 *
 * UpdatePrompt answers every manual check, but it only mounts where the app can
 * update itself. This is the backstop for anywhere it does not, so the button
 * cannot spin forever.
 */
const TIMEOUT_MS = 15000

/** The installed app itself: what is running, and whether newer exists. */
export default function AppInfoSettings() {
  const [version, setVersion] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    installedApp().then(info => setVersion(info.version)).catch(() => {})
  }, [])

  useEffect(() => {
    function done(e: Event) {
      window.clearTimeout(timer.current)
      setChecking(false)
      // A found update opens its own dialog, so saying anything here would just
      // be a second voice. Only the quiet answer needs reporting.
      const { found } = (e as CustomEvent<UpdateCheckResult>).detail
      if (!found) setMsg({ ok: true, text: "You're on the latest version" })
    }
    window.addEventListener(UPDATE_CHECK_DONE_EVENT, done)
    return () => {
      window.removeEventListener(UPDATE_CHECK_DONE_EVENT, done)
      window.clearTimeout(timer.current)
    }
  }, [])

  function check() {
    setMsg(null)
    setChecking(true)
    timer.current = window.setTimeout(() => {
      setChecking(false)
      setMsg({ ok: false, text: 'Could not reach the server' })
    }, TIMEOUT_MS)
    requestUpdateCheck()
  }

  return (
    <SettingsCard title="This app">
      {version && (
        <Field label="Version">
          <span className="tile-mono">{version}</span>
        </Field>
      )}

      {canSelfUpdate() && (
        <>
          <div className="settings-actions">
            <button className="btn btn-ghost" onClick={check} disabled={checking}>
              <RefreshCw size={15} className={checking ? 'spin' : undefined} />
              {checking ? 'Checking…' : 'Check for updates'}
            </button>
            <StatusMsg msg={msg} />
          </div>
          <span className="field-hint">
            The app already checks at launch and when you come back to it. This is for right after
            you have upgraded the server.
          </span>
        </>
      )}
    </SettingsCard>
  )
}
