import { useState } from 'react'
import { api, ApiError, type AdminSettings } from '../../lib/api'
import SettingsCard from '../../components/SettingsCard'
import StatusMsg, { type Msg } from '../../components/StatusMsg'

interface Props {
  settings: AdminSettings
  onSaved: (s: AdminSettings) => void
}

/** The longest wait an administrator can impose; matches the server's bound. */
const MAX_COOLDOWN = 24 * 60 * 60

/**
 * Instance-wide rules for what members may do to each other.
 *
 * One setting so far, and it is here rather than in each person's own settings
 * because it protects the *recipient* from the sender: a limit the sender could
 * raise is not a limit.
 */
export default function SocialAdmin({ settings, onSaved }: Props) {
  const [seconds, setSeconds] = useState(String(settings.social.pingCooldownSeconds))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  const parsed = Number(seconds)
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_COOLDOWN

  async function save() {
    setBusy(true); setMsg(null)
    try {
      onSaved(await api.saveSocial({ pingCooldownSeconds: parsed }))
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBusy(false) }
  }

  return (
    <SettingsCard title="Pings">
      <label className="field">
        <span className="field-label">Wait between pings (seconds)</span>
        <input
          className="input"
          type="number"
          min={1}
          max={MAX_COOLDOWN}
          value={seconds}
          onChange={e => setSeconds(e.target.value)}
        />
      </label>
      <span className="field-hint">
        How long someone must wait before nudging the <em>same</em> person again from their
        profile. Counted per pair, so nudging two different people in the same minute is
        unaffected. Anyone who would rather receive none at all can switch pings off in their own
        notification settings.
      </span>
      <div className="settings-actions">
        <button className="btn btn-primary" onClick={save} disabled={busy || !valid}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <StatusMsg msg={msg} />
      </div>
    </SettingsCard>
  )
}
