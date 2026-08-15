import { useCallback, useEffect, useState } from 'react'
import { Lock, LogOut, Monitor, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useRefreshHandler } from '../../context/RefreshContext'
import { api, ApiError, type SessionInfo } from '../../lib/api'
import PasswordInput from '../../components/PasswordInput'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'
import SessionCard from '../../components/SessionCard'

/** Password and the devices currently signed in. */
export default function SecuritySettings() {
  const { user } = useAuth()

  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [pwMsg, setPwMsg] = useState<Msg | null>(null)
  const [pwBusy, setPwBusy] = useState(false)

  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)

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

  async function changePassword() {
    setPwBusy(true); setPwMsg(null)
    try {
      await api.changePassword(currentPw, newPw)
      setCurrentPw(''); setNewPw('')
      setPwMsg({ ok: true, text: 'Password changed' })
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Change failed' })
    } finally { setPwBusy(false) }
  }

  const refresh = useCallback(async () => {
    try { setSessions((await api.listSessions()).sessions) } catch { /* keep the old list */ }
  }, [])

  // This page fetches its own sessions, so it has to opt into the pull gesture
  // itself — the shared workout cache is the only thing registered by default,
  // and pulling here did nothing at all.
  useRefreshHandler(refresh)

  async function signOutOthers() {
    setBusy(true)
    try { await api.revokeOtherSessions(); await refresh() } catch { /* ignore */ } finally { setBusy(false) }
  }

  async function signOutOne(id: string) {
    setRevokingId(id)
    try { await api.revokeSession(id); await refresh() } catch { /* ignore */ } finally { setRevokingId(null) }
  }

  const others = sessions.filter(s => !s.current).length

  return (
    <>
      <SettingsCard title="Password" icon={<Lock size={15} />}>
        {user.hasPassword ? (
          <>
            <div className="field-grid">
              <Field label="Current password">
                <PasswordInput autoComplete="current-password" capsLockWarning value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
              </Field>
              <Field label="New password">
                <PasswordInput autoComplete="new-password" capsLockWarning value={newPw} onChange={e => setNewPw(e.target.value)} />
              </Field>
            </div>
            <div className="settings-actions">
              <button className="btn btn-ghost" onClick={changePassword} disabled={pwBusy || !currentPw || !newPw}>
                {pwBusy ? 'Updating…' : 'Update password'}
              </button>
              <StatusMsg msg={pwMsg} />
            </div>
          </>
        ) : (
          <div className="notice">
            <ShieldCheck size={16} />
            You sign in through your identity provider, which manages your password.
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Signed-in devices"
        icon={<Monitor size={15} />}
        actions={
          <button className="btn btn-ghost" onClick={signOutOthers} disabled={busy || others === 0}>
            <LogOut size={14} /> Sign out others
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sessions.length === 0 && <span className="field-hint">No active sessions found.</span>}
          {sessions.map(sess => (
            <SessionCard
              key={sess.id}
              session={sess}
              action={sess.current ? (
                <span className="badge" style={{ background: 'var(--primary-dim)', color: 'var(--primary)', flexShrink: 0 }}>This device</span>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={() => signOutOne(sess.id)}
                  disabled={revokingId === sess.id}
                  style={{ flexShrink: 0 }}
                >
                  <LogOut size={14} /> {revokingId === sess.id ? 'Signing out…' : 'Sign out'}
                </button>
              )}
            />
          ))}
        </div>
      </SettingsCard>
    </>
  )
}
