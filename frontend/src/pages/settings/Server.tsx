import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { apiBase, forgetServer } from '../../lib/serverConfig'
import { installedApp, requestUpdateCheck } from '../../lib/native/appUpdate'
import ConfirmDialog from '../../components/ConfirmDialog'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'

/**
 * Which server the installed app talks to. Native only: in a browser the answer
 * is "the one that served this page" and cannot be changed.
 */
export default function ServerSettings() {
  const { logout } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)

  useEffect(() => {
    installedApp().then(info => setAppVersion(info.version)).catch(() => {})
  }, [])

  /**
   * Points the app at a different server.
   *
   * The session is revoked first, while the address that owns it is still
   * known — afterwards there is nothing left to revoke it against, and it would
   * stay valid until it expired.
   */
  async function disconnect() {
    setDisconnecting(true)
    await logout()
    // Returns to the setup screen by unmounting the providers, which takes all
    // the old server's state with them. No page reload; see forgetServer.
    await forgetServer()
  }

  return (
    <SettingsCard title="Connection">
      <Field label="Connected to">
        <div className="tile tile-mono">{apiBase()}</div>
      </Field>

      {appVersion && (
        <Field label="App version">
          <span className="tile-mono">{appVersion}</span>
        </Field>
      )}

      <div className="settings-actions">
        {/* The app checks on its own at launch and on resume; this is for
            someone who has just upgraded their server and wants the new app
            now rather than at the next check. */}
        <button className="btn btn-ghost" onClick={requestUpdateCheck}>Check for updates</button>
        <button className="btn btn-ghost" onClick={() => setConfirm(true)}>Disconnect</button>
      </div>
      <span className="field-hint">
        Disconnecting signs you out on this device and returns to the setup screen. Nothing on the
        server changes.
      </span>

      {confirm && (
        <ConfirmDialog
          title="Disconnect from this server?"
          message="You will be signed out on this device and returned to the setup screen. Nothing on the server is changed."
          confirmLabel="Disconnect"
          busyLabel="Disconnecting…"
          busy={disconnecting}
          danger
          onConfirm={() => void disconnect()}
          onCancel={() => setConfirm(false)}
        />
      )}
    </SettingsCard>
  )
}
