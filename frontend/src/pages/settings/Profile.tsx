import { useRef, useState } from 'react'
import { AlertTriangle, Trash2, Upload } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { api, ApiError } from '../../lib/api'
import { avatarUrl } from '../../components/UserAvatar'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'

/** Name, email, picture — and the account itself. */
export default function ProfileSettings() {
  const { user, setUser, logout } = useAuth()

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [msg, setMsg] = useState<Msg | null>(null)
  const [busy, setBusy] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)

  const [delStage, setDelStage] = useState<'idle' | 'sent'>('idle')
  const [delCode, setDelCode] = useState('')
  const [delMsg, setDelMsg] = useState<Msg | null>(null)
  const [delBusy, setDelBusy] = useState(false)

  if (!user) return null

  const fail = (err: unknown, fallback: string) =>
    ({ ok: false, text: err instanceof ApiError ? err.message : fallback })

  async function saveProfile() {
    setBusy(true); setMsg(null)
    try {
      const { user: updated } = await api.updateProfile(displayName.trim(), email.trim())
      setUser(updated)
      setMsg({ ok: true, text: 'Profile updated' })
    } catch (err) {
      setMsg(fail(err, 'Update failed'))
    } finally { setBusy(false) }
  }

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAvatarBusy(true); setMsg(null)
    try {
      const { user: updated } = await api.uploadAvatar(file)
      setUser(updated)
      setMsg({ ok: true, text: 'Picture updated' })
    } catch (err) {
      setMsg(fail(err, 'Upload failed'))
    } finally { setAvatarBusy(false) }
  }

  async function removeAvatar() {
    setAvatarBusy(true); setMsg(null)
    try {
      const { user: updated } = await api.deleteAvatar()
      setUser(updated)
      setMsg({ ok: true, text: 'Using your generated avatar' })
    } catch (err) {
      setMsg(fail(err, 'Could not remove picture'))
    } finally { setAvatarBusy(false) }
  }

  async function requestDeletion() {
    setDelBusy(true); setDelMsg(null)
    try {
      const r = await api.requestAccountDeletion()
      setDelStage('sent')
      setDelMsg({ ok: true, text: `Code sent to ${r.email}` })
    } catch (err) {
      setDelMsg(fail(err, 'Could not send code'))
    } finally { setDelBusy(false) }
  }

  async function confirmDeletion() {
    setDelBusy(true); setDelMsg(null)
    try {
      await api.confirmAccountDeletion(delCode.trim())
      await logout()
    } catch (err) {
      setDelMsg(fail(err, 'Deletion failed'))
    } finally { setDelBusy(false) }
  }

  const facts = [
    { label: 'Username', value: user.username },
    { label: 'Role', value: user.role || (user.isAdmin ? 'administrator' : 'reader') },
    { label: 'Sign-in', value: user.hasPassword ? 'Username & password' : 'OIDC / SSO' },
  ]

  return (
    <>
      <SettingsCard title="Picture">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img
            src={avatarUrl(user)}
            alt=""
            style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: 'var(--bg-3)' }}
          />
          <div style={{ minWidth: 0 }}>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarPick} />
            <div className="settings-actions">
              <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={avatarBusy}>
                <Upload size={14} /> {avatarBusy ? 'Uploading…' : user.avatarPath ? 'Change' : 'Upload'}
              </button>
              {/* Only offered when there is an upload to remove — the generated
                  avatar is not something you can delete. */}
              {user.avatarPath && (
                <button className="btn btn-ghost" onClick={removeAvatar} disabled={avatarBusy}>
                  <Trash2 size={14} /> Remove
                </button>
              )}
            </div>
            <span className="field-hint" style={{ display: 'block', marginTop: 6 }}>
              {user.avatarPath ? 'Large images are scaled down.' : 'Generated from your username.'}
            </span>
          </div>
        </div>
      </SettingsCard>

      <SettingsCard title="Details">
        <div className="field-grid">
          <Field label="Display name">
            <input className="input" style={{ width: '100%' }} value={displayName} onChange={e => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" style={{ width: '100%' }} value={email} onChange={e => setEmail(e.target.value)} />
          </Field>
        </div>
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={saveProfile} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <StatusMsg msg={msg} />
        </div>
        <div className="field-grid" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
          {facts.map(f => (
            <div key={f.label}>
              <div className="field-label">{f.label}</div>
              <div style={{ fontSize: 13, fontWeight: 500, marginTop: 4, textTransform: f.label === 'Role' ? 'capitalize' : 'none' }}>
                {f.value}
              </div>
            </div>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Delete account"
        icon={<Trash2 size={15} />}
        description="Removes your account and all workout data for good. We email a confirmation code first."
        danger
      >
        {delStage === 'idle' ? (
          <div className="settings-actions">
            <button className="btn" onClick={requestDeletion} disabled={delBusy} style={{ background: 'var(--danger)', color: '#fff' }}>
              <AlertTriangle size={14} /> {delBusy ? 'Sending…' : 'Send confirmation code'}
            </button>
            <StatusMsg msg={delMsg} />
          </div>
        ) : (
          <>
            <div className="settings-actions" style={{ alignItems: 'flex-end' }}>
              <Field label="Confirmation code">
                <input
                  className="input"
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={delCode}
                  onChange={e => setDelCode(e.target.value)}
                  style={{ width: 160, letterSpacing: '0.2em', fontFamily: 'var(--font-mono)' }}
                />
              </Field>
              <button
                className="btn"
                onClick={confirmDeletion}
                disabled={delBusy || delCode.trim().length < 4}
                style={{ background: 'var(--danger)', color: '#fff' }}
              >
                <Trash2 size={14} /> {delBusy ? 'Deleting…' : 'Permanently delete'}
              </button>
              <button className="btn btn-ghost" onClick={() => { setDelStage('idle'); setDelCode(''); setDelMsg(null) }} disabled={delBusy}>
                Cancel
              </button>
            </div>
            <StatusMsg msg={delMsg} />
          </>
        )}
      </SettingsCard>
    </>
  )
}
