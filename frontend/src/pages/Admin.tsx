import { useEffect, useState } from 'react'
import { Mail, KeyRound, Users, Send, Plus, Trash2, Lock } from 'lucide-react'
import {
  api,
  ApiError,
  type AdminSettings,
  type AdminUser,
  type SmtpInput,
  type OidcInput,
} from '../lib/api'

const ROLES = ['administrator', 'editor', 'reader']
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

      <div className="page-content" style={{ maxWidth: 860, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {loadErr && <div className="card" style={{ color: 'var(--red, #dc2626)' }}>{loadErr}</div>}
        {settings && <SmtpSection settings={settings} onSaved={setSettings} />}
        {settings && <OidcSection settings={settings} onSaved={setSettings} />}
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
          <input className="input" type="password" style={{ width: '100%' }}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input className="input" style={{ flex: '1 1 240px' }} type="email"
            placeholder="recipient@example.com (defaults to your email)"
            value={testTo} onChange={e => setTestTo(e.target.value)} />
          <button className="btn btn-ghost" onClick={sendTest} disabled={testBusy}>
            <Send size={14} /> {testBusy ? 'Sending…' : 'Send test'}
          </button>
          <StatusText msg={testMsg} />
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
  const [allowRegistration, setAllowRegistration] = useState(s.allowRegistration)
  const [scopes, setScopes] = useState((s.scopes || []).join(' '))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function save() {
    setBusy(true); setMsg(null)
    const payload: OidcInput = {
      enabled, issuerUrl, clientId, clientSecret, redirectUrl,
      adminGroup, providerName, allowRegistration,
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
          <input className="input" style={{ width: '100%' }} value={redirectUrl} disabled={ov.redirectUrl} onChange={e => setRedirectUrl(e.target.value)} />
        </Field>
        <Field label="Client ID" over={ov.clientId}>
          <input className="input" style={{ width: '100%' }} value={clientId} disabled={ov.clientId} onChange={e => setClientId(e.target.value)} />
        </Field>
        <Field label="Client Secret" over={ov.clientSecret}>
          <input className="input" type="password" style={{ width: '100%' }}
            placeholder={s.clientSecretSet ? '•••••••• (unchanged)' : ''}
            value={clientSecret} disabled={ov.clientSecret} onChange={e => setClientSecret(e.target.value)} />
        </Field>
        <Field label="Provider Name" over={ov.providerName}>
          <input className="input" style={{ width: '100%' }} value={providerName} disabled={ov.providerName} onChange={e => setProviderName(e.target.value)} />
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

function UsersSection({ users, onChanged }: { users: AdminUser[]; onChanged: () => void }) {
  const [showCreate, setShowCreate] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  async function updateUser(u: AdminUser, patch: { role?: string; isActive?: boolean }) {
    setMsg(null)
    try {
      await api.updateUser(u.id, {
        role: patch.role ?? u.role,
        isActive: patch.isActive ?? u.isActive,
      })
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
        <button className="btn btn-ghost" onClick={() => setShowCreate(v => !v)}>
          <Plus size={14} /> Add user
        </button>
      </div>

      {showCreate && <CreateUser onDone={() => { setShowCreate(false); onChanged() }} />}
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
                  <select className="input" value={u.role} onChange={e => updateUser(u, { role: e.target.value })}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td style={{ padding: '8px 10px' }}>
                  <input type="checkbox" checked={u.isActive} onChange={e => updateUser(u, { isActive: e.target.checked })} />
                </td>
                <td style={{ padding: '8px 10px', color: 'var(--text-3)' }}>{fmtDate(u.lastLoginAt)}</td>
                <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                  <button className="btn btn-ghost" onClick={() => removeUser(u)} title="Delete user"
                    style={{ color: 'var(--red, #dc2626)' }}>
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CreateUser({ onDone }: { onDone: () => void }) {
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
          <input className="input" type="password" style={{ width: '100%' }} value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
        <Field label="Role">
          <select className="input" style={{ width: '100%' }} value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <button className="btn btn-primary" onClick={create} disabled={busy} style={{ opacity: busy ? 0.5 : 1 }}>Create user</button>
        <StatusText msg={msg} />
      </div>
    </div>
  )
}
