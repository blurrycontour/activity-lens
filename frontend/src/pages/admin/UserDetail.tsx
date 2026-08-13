import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Dumbbell, HardDrive, Images, LogOut, Watch } from 'lucide-react'
import { api, ApiError, type AdminUserDetail, type UserStats } from '../../lib/api'
import SettingsCard from '../../components/SettingsCard'
import SessionCard from '../../components/SessionCard'
import ConfirmDialog from '../../components/ConfirmDialog'
import StatusMsg, { type Msg } from '../../components/StatusMsg'
import UserAvatar from '../../components/UserAvatar'

/** Bytes as something a person can compare at a glance. */
export function fmtBytes(n: number): string {
  if (!n) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const v = n / Math.pow(1024, i)
  // No decimal on bytes and kilobytes: "1.4 KB" is false precision for a
  // number that exists to be compared with a megabyte.
  return `${i < 2 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function Stat({ icon, label, value, sub }: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="admin-stat">
      <span className="admin-stat-icon">{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div className="admin-stat-value">{value}</div>
        <div className="admin-stat-label">{label}</div>
        {sub && <div className="admin-stat-sub">{sub}</div>}
      </div>
    </div>
  )
}

/**
 * Everything about one account, for an administrator.
 *
 * Local state rather than a route of its own, unlike the equipment detail this
 * resembles: nothing here navigates away to another page, so there is no
 * unmount to survive and the back button is the one on screen. Adding a URL
 * would buy a linkable admin page nobody links to.
 */
export default function UserDetailAdmin({ userId, onBack }: {
  userId: number
  onBack: () => void
}) {
  const [data, setData] = useState<AdminUserDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await api.getAdminUser(userId))
      setErr(null)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not load this user')
    }
  }, [userId])
  useEffect(() => { void load() }, [load])

  async function revoke(sessionId: string) {
    setRevoking(sessionId)
    setMsg(null)
    try {
      await api.revokeUserSession(userId, sessionId)
      await load()
      setMsg({ ok: true, text: 'Device signed out' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not revoke that session' })
    } finally {
      setRevoking(null)
      setPending(null)
    }
  }

  if (err) {
    return (
      <>
        <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="settings-card danger"><span className="status-msg err">{err}</span></div>
      </>
    )
  }
  if (!data) return <div className="field-hint" style={{ padding: 24 }}>Loading…</div>

  const u = data.user
  const s: UserStats = data.stats
  const disk = s.photoBytes + s.originalBytes

  return (
    <>
      <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 16 }}>
        <ArrowLeft size={16} /> Back to users
      </button>

      <SettingsCard title={u.displayName || u.username}>
        <div className="admin-user-head">
          <UserAvatar user={u} size={44} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{u.displayName || u.username}</div>
            <div className="field-hint">{u.email}</div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="badge" style={{ textTransform: 'capitalize' }}>{u.role}</span>
            <span className={`badge ${u.isActive ? 'badge-ok' : 'badge-off'}`}>
              {u.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        <div className="admin-stat-grid">
          <Stat
            icon={<Dumbbell size={15} />}
            label="Workouts"
            value={String(s.workouts)}
            sub={s.workouts > 0 ? `${fmtDate(s.firstWorkout)} – ${fmtDate(s.lastWorkout)}` : undefined}
          />
          <Stat icon={<Watch size={15} />} label="Equipment" value={String(s.equipment)} />
          <Stat
            icon={<Images size={15} />}
            label="Photos"
            value={String(s.photos)}
            sub={s.photoBytes > 0 ? fmtBytes(s.photoBytes) : undefined}
          />
          <Stat
            icon={<HardDrive size={15} />}
            label="Storage"
            value={fmtBytes(disk)}
            // Split out because the two are governed by different things: photos
            // exist because someone added them, originals because an admin left
            // archiving on — and only one of those is an admin's to reclaim.
            sub={s.originalBytes > 0 ? `${fmtBytes(s.originalBytes)} of originals` : undefined}
          />
        </div>
        <div className="field-hint" style={{ marginTop: 12 }}>
          Last signed in {fmtDate(u.lastLoginAt) === '—' ? 'never' : fmtDate(u.lastLoginAt)}
        </div>
      </SettingsCard>

      <SettingsCard title={`Signed-in devices (${data.sessions.length})`}>
        <StatusMsg msg={msg} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.sessions.length === 0 && (
            <span className="field-hint">This account has no active sessions.</span>
          )}
          {data.sessions.map(sess => (
            <SessionCard
              key={sess.id}
              session={sess}
              action={
                <button
                  className="btn btn-ghost"
                  onClick={() => setPending(sess.id)}
                  disabled={revoking === sess.id}
                  style={{ flexShrink: 0 }}
                >
                  <LogOut size={14} /> {revoking === sess.id ? 'Signing out…' : 'Sign out'}
                </button>
              }
            />
          ))}
        </div>
      </SettingsCard>

      {/* Signing someone else's device out is not something to do by mis-tap,
          and from here it is invisible to whoever it happens to until they are
          asked to sign in again. */}
      {pending && (
        <ConfirmDialog
          title="Sign this device out?"
          message={<>
            This signs “{u.displayName || u.username}” out on that device. They will need to sign
            in again there; nothing else about the account changes.
          </>}
          confirmLabel="Sign out"
          busy={revoking === pending}
          busyLabel="Signing out…"
          onCancel={() => setPending(null)}
          onConfirm={() => void revoke(pending)}
        />
      )}
    </>
  )
}
