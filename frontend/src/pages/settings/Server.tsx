import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { apiBase, forgetServer } from '../../lib/serverConfig'
import ConfirmDialog from '../../components/ConfirmDialog'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'

/**
 * Which server the installed app talks to. Native only: in a browser the answer
 * is "the one that served this page" and cannot be changed.
 *
 * The app's own version and update check live under App — they are facts about
 * this install, not about the server it happens to point at.
 */
export default function ServerSettings() {
  const { logout } = useAuth()
  const [confirm, setConfirm] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

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

      <div className="settings-actions">
        {/* Danger ink on a ghost button, the same shape Equipment's Delete
            uses: this signs you out and drops the server, and it sat looking
            exactly like every harmless button on the page. Not a filled danger
            button — the confirmation dialog behind it is where the weight
            belongs, and a solid red block in a settings list reads as an
            error message rather than as a control. */}
        <button className="btn btn-ghost" style={{ color: 'var(--danger)' }} onClick={() => setConfirm(true)}>
          Disconnect
        </button>
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
