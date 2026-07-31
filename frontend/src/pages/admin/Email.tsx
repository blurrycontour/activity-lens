import { useState } from 'react'
import { Send } from 'lucide-react'
import { api, ApiError, type AdminSettings, type SmtpInput } from '../../lib/api'
import PasswordInput from '../../components/PasswordInput'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'
import Dropdown, { type DropdownOption } from '../../components/Dropdown'

const ENCRYPTION_OPTIONS: DropdownOption<string>[] = [
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'tls', label: 'TLS' },
  { value: 'none', label: 'None' },
]

interface Props {
  settings: AdminSettings
  onSaved: (s: AdminSettings) => void
}

export default function EmailAdmin({ settings, onSaved }: Props) {
  const s = settings.smtp
  const ov = s.overridden || {}
  const [host, setHost] = useState(s.host)
  const [port, setPort] = useState(String(s.port))
  const [username, setUsername] = useState(s.username)
  const [password, setPassword] = useState('')
  const [from, setFrom] = useState(s.from)
  const [fromName, setFromName] = useState(s.fromName)
  const [encryption, setEncryption] = useState(s.encryption)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [testTo, setTestTo] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [testMsg, setTestMsg] = useState<Msg | null>(null)

  async function save() {
    setBusy(true); setMsg(null)
    const payload: SmtpInput = { host, port: parseInt(port, 10) || 0, username, password, from, fromName, encryption }
    try {
      onSaved(await api.saveSMTP(payload))
      setPassword('')
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBusy(false) }
  }

  async function sendTest() {
    setTestBusy(true); setTestMsg(null)
    try {
      const r = await api.testEmail(testTo.trim())
      setTestMsg({ ok: true, text: `Sent to ${r.to}` })
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Send failed' })
    } finally { setTestBusy(false) }
  }

  return (
    <>
      <SettingsCard title="SMTP server" description="Only needed for account-deletion confirmation codes.">
        <div className="field-grid">
          <Field label="Host" overridden={ov.host}>
            <input className="input" style={{ width: '100%' }} value={host} disabled={ov.host} onChange={e => setHost(e.target.value)} />
          </Field>
          <Field label="Port" overridden={ov.port}>
            <input className="input" type="number" style={{ width: '100%' }} value={port} disabled={ov.port} onChange={e => setPort(e.target.value)} />
          </Field>
          <Field label="Username" overridden={ov.username}>
            <input className="input" style={{ width: '100%' }} value={username} disabled={ov.username} onChange={e => setUsername(e.target.value)} />
          </Field>
          <Field label="Password" overridden={ov.password}>
            <PasswordInput
              placeholder={s.passwordSet ? '•••••••• (unchanged)' : ''}
              value={password} disabled={ov.password} onChange={e => setPassword(e.target.value)} />
          </Field>
          <Field label="From address" overridden={ov.from}>
            <input className="input" type="email" style={{ width: '100%' }} value={from} disabled={ov.from} onChange={e => setFrom(e.target.value)} />
          </Field>
          <Field label="From name" overridden={ov.fromName}>
            <input className="input" style={{ width: '100%' }} value={fromName} disabled={ov.fromName} onChange={e => setFromName(e.target.value)} />
          </Field>
          <Field label="Encryption" overridden={ov.encryption}>
            <Dropdown
              block
              value={encryption}
              options={ENCRYPTION_OPTIONS}
              disabled={ov.encryption}
              onChange={setEncryption}
              ariaLabel="Encryption"
            />
          </Field>
        </div>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          <StatusMsg msg={msg} />
        </div>
      </SettingsCard>

      <SettingsCard title="Test">
        <Field label="Send to" hint="Defaults to your own email address.">
          <input className="input" style={{ width: '100%' }} type="email"
            placeholder="recipient@example.com"
            value={testTo} onChange={e => setTestTo(e.target.value)} />
        </Field>
        <div className="settings-actions">
          <button className="btn btn-ghost" onClick={sendTest} disabled={testBusy}>
            <Send size={14} /> {testBusy ? 'Sending…' : 'Send test email'}
          </button>
          <StatusMsg msg={testMsg} />
        </div>
      </SettingsCard>
    </>
  )
}
