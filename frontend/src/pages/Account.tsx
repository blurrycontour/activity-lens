import { useEffect, useRef, useState } from 'react'
import { Lock, ShieldCheck, User as UserIcon, Upload, Monitor, LogOut, Trash2, AlertTriangle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api, ApiError, type SessionInfo } from '../lib/api'
import { avatarUrl } from '../components/UserAvatar'

function formatDate(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export default function Account() {
  const { user, setUser, logout } = useAuth()

  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [profileBusy, setProfileBusy] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const [avatarBusy, setAvatarBusy] = useState(false)

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pwBusy, setPwBusy] = useState(false)

  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [sessionsBusy, setSessionsBusy] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const [delStage, setDelStage] = useState<'idle' | 'sent'>('idle')
  const [delCode, setDelCode] = useState('')
  const [delMsg, setDelMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [delBusy, setDelBusy] = useState(false)

  const userId = user?.id
  useEffect(() => {
    if (userId == null) return
    let alive = true
    api.listSessions()
      .then(r => { if (alive) setSessions(r.sessions) })
      .catch(() => { if (alive) setSessions([]) })
    return () => { alive = false }
  }, [userId])

  if (!user) return null

  const loginType = user.hasPassword ? 'Username & Password' : 'OIDC / SSO'

  async function saveProfile() {
    setProfileBusy(true)
    setProfileMsg(null)
    try {
      const { user: updated } = await api.updateProfile(displayName.trim(), email.trim())
      setUser(updated)
      setProfileMsg({ ok: true, text: 'Profile updated' })
    } catch (err) {
      setProfileMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Update failed' })
    } finally {
      setProfileBusy(false)
    }
  }

  async function changePassword() {
    setPwBusy(true)
    setPwMsg(null)
    try {
      await api.changePassword(currentPw, newPw)
      setCurrentPw('')
      setNewPw('')
      setPwMsg({ ok: true, text: 'Password changed' })
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Change failed' })
    } finally {
      setPwBusy(false)
    }
  }

  async function onAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setAvatarBusy(true)
    setProfileMsg(null)
    try {
      const { user: updated } = await api.uploadAvatar(file)
      setUser(updated)
      setProfileMsg({ ok: true, text: 'Profile picture updated' })
    } catch (err) {
      setProfileMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Upload failed' })
    } finally {
      setAvatarBusy(false)
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true)
    setProfileMsg(null)
    try {
      const { user: updated } = await api.deleteAvatar()
      setUser(updated)
      setProfileMsg({ ok: true, text: 'Picture removed — using your generated avatar' })
    } catch (err) {
      setProfileMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not remove picture' })
    } finally {
      setAvatarBusy(false)
    }
  }

  async function signOutOthers() {
    setSessionsBusy(true)
    try {
      await api.revokeOtherSessions()
      const r = await api.listSessions()
      setSessions(r.sessions)
    } catch {
      /* ignore */
    } finally {
      setSessionsBusy(false)
    }
  }

  async function signOutOne(id: string) {
    setRevokingId(id)
    try {
      await api.revokeSession(id)
      const r = await api.listSessions()
      setSessions(r.sessions)
    } catch {
      /* ignore */
    } finally {
      setRevokingId(null)
    }
  }

  async function requestDeletion() {
    setDelBusy(true)
    setDelMsg(null)
    try {
      const r = await api.requestAccountDeletion()
      setDelStage('sent')
      setDelMsg({ ok: true, text: `Confirmation code sent to ${r.email}` })
    } catch (err) {
      setDelMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not send code' })
    } finally {
      setDelBusy(false)
    }
  }

  async function confirmDeletion() {
    setDelBusy(true)
    setDelMsg(null)
    try {
      await api.confirmAccountDeletion(delCode.trim())
      await logout()
    } catch (err) {
      setDelMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Deletion failed' })
    } finally {
      setDelBusy(false)
    }
  }

  const immutable: { label: string; value: string }[] = [
    { label: 'Username', value: user.username },
    { label: 'Role', value: user.role || (user.isAdmin ? 'administrator' : 'reader') },
    { label: 'Login Type', value: loginType },
  ]

  return (
    <>
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Account</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Manage your profile and security</p>
      </div>

      <div className="page-content" style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Profile */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <UserIcon size={15} /> Profile
          </h3>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <img
              src={avatarUrl(user)}
              alt="Avatar"
              style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: 'var(--bg-3)' }}
            />
            <div>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={onAvatarPick} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={avatarBusy}>
                  <Upload size={14} /> {avatarBusy ? 'Uploading…' : user.avatarPath ? 'Change picture' : 'Upload picture'}
                </button>
                {/* Only offered when there is an upload to remove — the
                    generated avatar is not something you can delete. */}
                {user.avatarPath && (
                  <button className="btn btn-ghost" onClick={removeAvatar} disabled={avatarBusy}>
                    <Trash2 size={14} /> Remove
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 6 }}>
                {user.avatarPath
                  ? 'JPG, PNG or GIF. Large images are scaled down automatically.'
                  : 'This picture was generated from your username. Upload one to replace it.'}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Display Name</label>
              <input className="input" style={{ width: '100%' }} value={displayName} onChange={e => setDisplayName(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Email</label>
              <input className="input" type="email" style={{ width: '100%' }} value={email} onChange={e => setEmail(e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
            <button className="btn btn-primary" onClick={saveProfile} disabled={profileBusy} style={{ opacity: profileBusy ? 0.5 : 1 }}>
              {profileBusy ? 'Saving…' : 'Save Profile'}
            </button>
            {profileMsg && (
              <span style={{ fontSize: 12, color: profileMsg.ok ? 'var(--primary)' : '#ef4444' }}>{profileMsg.text}</span>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
            {immutable.map(f => (
              <div key={f.label}>
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 4 }}>{f.label}</div>
                <div style={{ fontSize: 13, fontWeight: 500, textTransform: f.label === 'Role' ? 'capitalize' : 'none' }}>{f.value}</div>
              </div>
            ))}
          </div>
        </section>

        {/* Change password */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={15} /> Change Password
          </h3>

          {user.hasPassword ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Current Password</label>
                  <input className="input" type="password" autoComplete="current-password" style={{ width: '100%' }} value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>New Password</label>
                  <input className="input" type="password" autoComplete="new-password" style={{ width: '100%' }} value={newPw} onChange={e => setNewPw(e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
                <button className="btn btn-ghost" onClick={changePassword} disabled={pwBusy || !currentPw || !newPw} style={{ opacity: (pwBusy || !currentPw || !newPw) ? 0.5 : 1 }}>
                  {pwBusy ? 'Updating…' : 'Update Password'}
                </button>
                {pwMsg && (
                  <span style={{ fontSize: 12, color: pwMsg.ok ? 'var(--primary)' : '#ef4444' }}>{pwMsg.text}</span>
                )}
              </div>
            </>
          ) : (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 14px', borderRadius: 8,
              background: 'var(--blue-dim)', color: 'var(--blue)',
              fontSize: 13,
            }}>
              <ShieldCheck size={16} />
              You sign in via OIDC / SSO — your password is managed by your identity provider and cannot be changed here.
            </div>
          )}
        </section>

        {/* Active sessions */}
        <section className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Monitor size={15} /> Active Sessions
            </h3>
            <button
              className="btn btn-ghost"
              onClick={signOutOthers}
              disabled={sessionsBusy || sessions.filter(s => !s.current).length === 0}
              style={{ opacity: (sessionsBusy || sessions.filter(s => !s.current).length === 0) ? 0.5 : 1 }}
            >
              <LogOut size={14} /> Sign out all others
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sessions.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No active sessions found.</div>
            )}
            {sessions.map(sess => (
              <div key={sess.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 8,
                background: 'var(--bg-3)', border: '1px solid var(--border)',
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {sess.userAgent || 'Unknown device'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                    {sess.ip || 'unknown IP'} · started {formatDate(sess.createdAt)}
                  </div>
                </div>
                {sess.current ? (
                  <span className="badge" style={{ background: 'var(--primary-dim)', color: 'var(--primary)' }}>This device</span>
                ) : (
                  <button
                    className="btn btn-ghost"
                    onClick={() => signOutOne(sess.id)}
                    disabled={revokingId === sess.id}
                    title="Sign out this session"
                    style={{ flexShrink: 0, opacity: revokingId === sess.id ? 0.5 : 1 }}
                  >
                    <LogOut size={14} /> {revokingId === sess.id ? 'Signing out…' : 'Sign out'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* Delete account */}
        <section className="card" style={{ borderColor: 'rgba(239,68,68,0.4)' }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444' }}>
            <Trash2 size={15} /> Delete Account
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Permanently deletes your account and all workout data. This action cannot be undone.
            We&apos;ll email a confirmation code before anything is removed.
          </p>

          {delStage === 'idle' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={requestDeletion}
                disabled={delBusy}
                style={{ background: '#ef4444', color: '#fff', opacity: delBusy ? 0.5 : 1 }}
              >
                <AlertTriangle size={14} /> {delBusy ? 'Sending…' : 'Send confirmation code'}
              </button>
              {delMsg && (
                <span style={{ fontSize: 12, color: delMsg.ok ? 'var(--primary)' : '#ef4444' }}>{delMsg.text}</span>
              )}
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Confirmation Code</label>
                  <input
                    className="input"
                    inputMode="numeric"
                    placeholder="6-digit code"
                    value={delCode}
                    onChange={e => setDelCode(e.target.value)}
                    style={{ width: 160, letterSpacing: '0.2em', fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                <button
                  className="btn"
                  onClick={confirmDeletion}
                  disabled={delBusy || delCode.trim().length < 4}
                  style={{ background: '#ef4444', color: '#fff', opacity: (delBusy || delCode.trim().length < 4) ? 0.5 : 1 }}
                >
                  <Trash2 size={14} /> {delBusy ? 'Deleting…' : 'Permanently delete'}
                </button>
                <button className="btn btn-ghost" onClick={() => { setDelStage('idle'); setDelCode(''); setDelMsg(null) }} disabled={delBusy}>
                  Cancel
                </button>
              </div>
              {delMsg && (
                <div style={{ fontSize: 12, marginTop: 10, color: delMsg.ok ? 'var(--primary)' : '#ef4444' }}>{delMsg.text}</div>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
