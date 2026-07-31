import { useState } from 'react'
import { api, ApiError, type AdminSettings } from '../../lib/api'
import SettingsCard from '../../components/SettingsCard'
import StatusMsg, { type Msg } from '../../components/StatusMsg'

interface Props {
  settings: AdminSettings
  onSaved: (s: AdminSettings) => void
}

export default function StorageAdmin({ settings, onSaved }: Props) {
  const [keepOriginalUploads, setKeep] = useState(settings.storage.keepOriginalUploads)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  async function save() {
    setBusy(true); setMsg(null)
    try {
      onSaved(await api.saveStorage({ keepOriginalUploads }))
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBusy(false) }
  }

  return (
    <SettingsCard title="Imported files">
      <label className="switch" style={{ fontSize: 13, color: 'var(--text)' }}>
        <input type="checkbox" checked={keepOriginalUploads} onChange={e => setKeep(e.target.checked)} />
        <span className="switch-track" />
        Keep the original GPX/TCX file
      </label>
      <span className="field-hint">
        Kept files let a future, improved importer reprocess history without asking anyone to
        re-upload. They are stored zstd-compressed — roughly a tenth of their original size — under
        <code> raw-uploads/</code> in the data directory. Off by default, which keeps only the parsed
        route, heart rate and pace.
      </span>
      <div className="settings-actions">
        <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <StatusMsg msg={msg} />
      </div>
    </SettingsCard>
  )
}
