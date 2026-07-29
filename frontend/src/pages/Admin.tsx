import { useEffect, useState } from 'react'
import { Mail, KeyRound, Users, Send, Plus, Trash2, Lock, Pencil, Check, X as XIcon, Database } from 'lucide-react'
import {
  api,
  ApiError,
  type AdminSettings,
  type AdminUser,
  type SmtpInput,
  type OidcInput,
} from '../lib/api'
import { useAuth } from '../context/AuthContext'
import PasswordInput from '../components/PasswordInput'

const ROLES =['administrator', 'editor', 'reader']
const ENCRYPTIONS = ['starttls', 'tls', 'none']

type Msg = { ok: boolean; text: string } | null

function fmtDate(iso: string) {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function labelStyle(): React.CSSProperties {
  return { fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }
}

function Field({
  label, over, children,
}: { label: string; over?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle()}>
        {label}
        {over && (
          <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--amber, #d97706)', fontWeight: 600 }}>
            (set by .env)
          </span>
        )}
      </label>
      {children}
    </div>
  )
}

function StatusText({ msg }: { msg: Msg }) {
  if (!msg) return null
  return (
    <span style={{ fontSize: 12, color: msg.ok ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)' }}>
      {msg.text}
    </span>
  )
}

export default function Admin() {
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const load = () => {
    api.getAdminSettings().then(setSettings).catch(e =>
      setLoadErr(e instanceof ApiError ? e.message : 'Failed to load settings'))
    api.listAdminUsers().then(r => setUsers(r.users)).catch(() => { /* ignore */ })
  }
  useEffect(load, [])

  return (
    <>
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Admin Panel</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Server configuration and user management</p>
      </div>

      <div className="page-content" style={{ maxWidth: 860, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {loadErr && <div className="card" style={{ color: 'var(--red, #dc2626)' }}>{loadErr}</div>}
        {settings && <SmtpSection settings={settings} onSaved={setSettings} />}
        {settings && <OidcSection settings={settings} onSaved={setSettings} />}
        {settings && <StorageSection settings={settings} onSaved={setSettings} />}
        <UsersSection users={users} onChanged={load} />
      </div>
    </>
  )
}

function SmtpSection({ settings, onSaved }: { settings: AdminSettings; onSaved: (s: AdminSettings) => void }) {
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
  const [msg, setMsg] = useState<Msg>(null)
  const [testTo, setTestTo] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const [testMsg, setTestMsg] = useState<Msg>(null)

  async function save() {
    setBusy(true); setMsg(null)
    const payload: SmtpInput = {
      host, port: parseInt(port, 10) || 0, username, password,
      from, fromName, encryption,
    }
    try {
      const updated = await api.saveSMTP(payload)
      onSaved(updated)
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
    <section className="card">
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Mail size={15} /> Email (SMTP)
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Field label="Host" over={ov.host}>
          <input className="input" style={{ width: '100%' }} value={host} disabled={ov.host} onChange={e => setHost(e.target.value)} />
        </Field>
        <Field label="Port" over={ov.port}>
          <input className="input" type="number" style={{ width: '100%' }} value={port} disabled={ov.port} onChange={e => setPort(e.target.value)} />
        </Field>
        <Field label="Username" over={ov.username}>
          <input className="input" style={{ width: '100%' }} value={username} disabled={ov.username} onChange={e => setUsername(e.target.value)} />
        </Field>
        <Field label="Password" over={ov.password}>
          <PasswordInput
            placeholder={s.passwordSet ? '•••••••• (unchanged)' : ''}
            value={password} disabled={ov.password} onChange={e => setPassword(e.target.value)} />
        </Field>
        <Field label="From Address" over={ov.from}>
          <input className="input" type="email" style={{ width: '100%' }} value={from} disabled={ov.from} onChange={e => setFrom(e.target.value)} />
        </Field>
        <Field label="From Name" over={ov.fromName}>
          <input className="input" style={{ width: '100%' }} value={fromName} disabled={ov.fromName} onChange={e => setFromName(e.target.value)} />
        </Field>
        <Field label="Encryption" over={ov.encryption}>
          <select className="input" style={{ width: '100%' }} value={encryption} disabled={ov.encryption} onChange={e => setEncryption(e.target.value)}>
            {ENCRYPTIONS.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>Save</button>
        <StatusText msg={msg} />
      </div>

      <div style={{ borderTop: '1px solid var(--border)', marginTop: 18, paddingTop: 16 }}>
        <label style={labelStyle()}>Send a test email</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input className="input" style={{ width: '100%' }} type="email"
            placeholder="recipient@example.com (defaults to your email)"
            value={testTo} onChange={e => setTestTo(e.target.value)} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={sendTest} disabled={testBusy}>
              <Send size={14} /> {testBusy ? 'Sending…' : 'Send test'}
            </button>
            <StatusText msg={testMsg} />
          </div>
        </div>
      </div>
    </section>
  )
}

function OidcSection({ settings, onSaved }: { settings: AdminSettings; onSaved: (s: AdminSettings) => void }) {
  const s = settings.oidc
  const ov = s.overridden || {}
  const [enabled, setEnabled] = useState(s.enabled)
  const [issuerUrl, setIssuerUrl] = useState(s.issuerUrl)
  const [clientId, setClientId] = useState(s.clientId)
  const [clientSecret, setClientSecret] = useState('')
  const [redirectUrl, setRedirectUrl] = useState(s.redirectUrl)
  const [adminGroup, setAdminGroup] = useState(s.adminGroup)
  const [providerName, setProviderName] = useState(s.providerName)
  const [logoUrl, setLogoUrl] = useState(s.logoUrl)
  const [allowRegistration, setAllowRegistration] = useState(s.allowRegistration)
  const [scopes, setScopes] = useState((s.scopes || []).join(' '))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function save() {
    setBusy(true); setMsg(null)
    const payload: OidcInput = {
      enabled, issuerUrl, clientId, clientSecret, redirectUrl,
      adminGroup, providerName, logoUrl, allowRegistration,
      scopes: scopes.split(/\s+/).map(x => x.trim()).filter(Boolean),
    }
    try {
      const updated = await api.saveOIDC(payload)
      onSaved(updated)
      setClientSecret('')
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <KeyRound size={15} /> OIDC / SSO
      </h3>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 13 }}>
        <input type="checkbox" checked={enabled} disabled={ov.enabled} onChange={e => setEnabled(e.target.checked)} />
        Enable single sign-on {ov.enabled && <span style={{ fontSize: 10, color: 'var(--amber, #d97706)', fontWeight: 600 }}>(set by .env)</span>}
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Field label="Issuer URL" over={ov.issuerUrl}>
          <input className="input" style={{ width: '100%' }} value={issuerUrl} disabled={ov.issuerUrl} onChange={e => setIssuerUrl(e.target.value)} />
        </Field>
        <Field label="Redirect URL" over={ov.redirectUrl}>
          <input className="input" style={{ width: '100%' }} value={redirectUrl} disabled={ov.redirectUrl} placeholder="https://your-domain/api/auth/oidc/callback" onChange={e => setRedirectUrl(e.target.value)} />
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Must end in <code>/api/auth/oidc/callback</code> and match the provider's allowed callback.</span>
        </Field>
        <Field label="Client ID" over={ov.clientId}>
          <input className="input" style={{ width: '100%' }} value={clientId} disabled={ov.clientId} onChange={e => setClientId(e.target.value)} />
        </Field>
        <Field label="Client Secret" over={ov.clientSecret}>
          <PasswordInput
            placeholder={s.clientSecretSet ? '•••••••• (unchanged)' : ''}
            value={clientSecret} disabled={ov.clientSecret} onChange={e => setClientSecret(e.target.value)} />
        </Field>
        <Field label="Provider Name" over={ov.providerName}>
          <input className="input" style={{ width: '100%' }} value={providerName} disabled={ov.providerName} onChange={e => setProviderName(e.target.value)} />
        </Field>
        <Field label="Logo URL" over={ov.logoUrl}>
          <input className="input" style={{ width: '100%' }} value={logoUrl} disabled={ov.logoUrl} placeholder="https://example.com/logo.svg" onChange={e => setLogoUrl(e.target.value)} />
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>Shown on the SSO button on the login screen.</span>
        </Field>
        <Field label="Admin Group" over={ov.adminGroup}>
          <input className="input" style={{ width: '100%' }} value={adminGroup} disabled={ov.adminGroup} onChange={e => setAdminGroup(e.target.value)} />
        </Field>
        <Field label="Scopes (space-separated)" over={ov.scopes}>
          <input className="input" style={{ width: '100%' }} value={scopes} disabled={ov.scopes} onChange={e => setScopes(e.target.value)} />
        </Field>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 13 }}>
        <input type="checkbox" checked={allowRegistration} disabled={ov.allowRegistration} onChange={e => setAllowRegistration(e.target.checked)} />
        Allow new users to register via SSO {ov.allowRegistration && <span style={{ fontSize: 10, color: 'var(--amber, #d97706)', fontWeight: 600 }}>(set by .env)</span>}
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>Save</button>
        <StatusText msg={msg} />
      </div>
    </section>
  )
}

function StorageSection({ settings, onSaved }: { settings: AdminSettings; onSaved: (s: AdminSettings) => void }) {
  const s = settings.storage
  const [keepOriginalUploads, setKeepOriginalUploads] = useState(s.keepOriginalUploads)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function save() {
    setBusy(true); setMsg(null)
    try {
      const updated = await api.saveStorage({ keepOriginalUploads })
      onSaved(updated)
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBusy(false) }
  }

  return (
    <section className="card">
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Database size={15} /> Storage
      </h3>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13 }}>
        <input type="checkbox" checked={keepOriginalUploads} onChange={e => setKeepOriginalUploads(e.target.checked)} />
        Keep original uploaded files (GPX/TCX)
      </label>
      <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 14 }}>
        <strong>On:</strong> the original file is kept alongside the parsed workout, so future import
        improvements can reprocess your history without re-uploading. Files are stored zstd-compressed
        (roughly a tenth of their original size) under <code>raw-uploads/</code> in the configured data
        directory.<br />
        <strong>Off</strong> (default): only the parsed data (route, heart rate, pace, etc.) is kept and the
        original file is discarded right after import, keeping the database as small as possible.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn btn-primary" onClick={save} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>Save</button>
        <StatusText msg={msg} />
      </div>
    </section>
  )
}

function UsersSection({ users, onChanged }: { users: AdminUser[]; onChanged: () => void }) {
  const { user: me } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draftRole, setDraftRole] = useState<string>('')
  const [draftActive, setDraftActive] = useState(true)
  const [msg, setMsg] = useState<Msg>(null)

  const activeAdminCount = users.filter(u => u.role === 'administrator' && u.isActive).length

  function startEdit(u: AdminUser) {
    setDraftRole(u.role)
    setDraftActive(u.isActive)
    setMsg(null)
    setEditingId(u.id)
  }

  async function saveEdit(u: AdminUser) {
    setMsg(null)
    try {
      await api.updateUser(u.id, { role: draftRole, isActive: draftActive })
      setEditingId(null)
      onChanged()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Update failed' })
    }
  }

  async function removeUser(u: AdminUser) {
    if (!confirm(`Delete user "${u.username}"? This cannot be undone.`)) return
    setMsg(null)
    try {
      await api.deleteUser(u.id)
      onChanged()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Delete failed' })
    }
  }

  return (
    <section className="card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Users size={15} /> User Management
        </h3>
        {showCreate ? (
          <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>
            <XIcon size={14} /> Cancel
          </button>
        ) : (
          <button className="btn btn-ghost" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Add user
          </button>
        )}
      </div>

      {showCreate && <CreateUser onDone={() => { setShowCreate(false); onChanged() }} onCancel={() => setShowCreate(false)} />}
      {msg && <div style={{ marginBottom: 10 }}><StatusText msg={msg} /></div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--text-3)', fontSize: 11 }}>
              <th style={{ padding: '8px 10px' }}>User</th>
              <th style={{ padding: '8px 10px' }}>Role</th>
              <th style={{ padding: '8px 10px' }}>Active</th>
              <th style={{ padding: '8px 10px' }}>Last Login</th>
              <th style={{ padding: '8px 10px' }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '8px 10px' }}>
                  <div style={{ fontWeight: 600 }}>{u.displayName || u.username}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {u.email}
                    {!u.hasPassword && (
                      <span style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Lock size={10} /> SSO
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '8px 10px' }}>
                  {editingId === u.id ? (
                    <select className="input" value={draftRole} onChange={e => setDraftRole(e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span>{u.role}</span>
                  )}
                </td>
                <td style={{ padding: '8px 10px' }}>
                  {editingId === u.id ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: u.id === me?.id ? 'not-allowed' : 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={draftActive}
                        disabled={u.id === me?.id}
                        title={u.id === me?.id ? 'You cannot deactivate your own account' : undefined}
                        onChange={e => setDraftActive(e.target.checked)}
                      />
                      <span style={{ fontSize: 12, color: draftActive ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)' }}>
                        {draftActive ? 'Active' : 'Inactive'}
                      </span>
                    </label>
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 600, color: u.isActive ? 'var(--green, #16a34a)' : 'var(--red, #dc2626)' }}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--text-3)', whiteSpace: 'nowrap' }}>{fmtDate(u.lastLoginAt)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  {editingId === u.id ? (
                    <>
                      <button className="btn btn-primary" onClick={() => saveEdit(u)} title="Save">
                        <Check size={14} />
                      </button>
                      <button className="btn btn-ghost" onClick={() => setEditingId(null)} title="Cancel" style={{ marginLeft: 6 }}>
                        <XIcon size={14} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="btn btn-ghost"
                        onClick={() => startEdit(u)}
                        title={u.role === 'administrator' && u.isActive && activeAdminCount <= 1 ? 'Last administrator — role/status locked' : 'Edit user'}
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => removeUser(u)}
                        title={u.id === me?.id ? 'You cannot delete your own account' : 'Delete user'}
                        disabled={u.id === me?.id}
                        style={{ color: 'var(--red, #dc2626)', marginLeft: 6 }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CreateUser({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('reader')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function create() {
    setBusy(true); setMsg(null)
    try {
      await api.createUser({ username: username.trim(), email: email.trim(), displayName: displayName.trim(), password, role })
      onDone()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Create failed' })
    } finally { setBusy(false) }
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Field label="Username">
          <input className="input" style={{ width: '100%' }} value={username} onChange={e => setUsername(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" style={{ width: '100%' }} value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field label="Display Name">
          <input className="input" style={{ width: '100%' }} value={displayName} onChange={e => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Password">
          <PasswordInput autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
        <Field label="Role">
          <select className="input" style={{ width: '100%' }} value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={create} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>Create user</button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <StatusText msg={msg} />
      </div>
    </div>
  )
}
