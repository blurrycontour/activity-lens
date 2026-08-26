import { useCallback, useEffect, useState } from 'react'
import { Circle, Dumbbell, HardDrive, Images, LogOut, Trash2, Watch } from 'lucide-react'
import { api, ApiError, type AdminUserDetail, type UserStats } from '../../lib/api'
import { useRefreshHandler } from '../../context/RefreshContext'
import SettingsCard from '../../components/SettingsCard'
import SessionCard from '../../components/SessionCard'
import ConfirmDialog from '../../components/ConfirmDialog'
import StatusMsg, { type Msg } from '../../components/StatusMsg'
import UserAvatar from '../../components/UserAvatar'
import Field from '../../components/Field'
import Dropdown, { type DropdownOption } from '../../components/Dropdown'
import { isActiveNow, lastActive } from '../../lib/date'

const ROLE_OPTIONS: DropdownOption<string>[] = ['administrator', 'editor', 'reader'].map(r => ({
  value: r,
  label: r.charAt(0).toUpperCase() + r.slice(1),
}))

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
export default function UserDetailAdmin({ userId, onBack, onChanged, isSelf, isLastAdmin }: {
  userId: number
  onBack: () => void
  /** Tells the list to refetch after a role change or a deletion. */
  onChanged: () => void
  /** Your own account: role, status and deletion are all closed here. */
  isSelf: boolean
  /** The only administrator who can still sign in. */
  isLastAdmin: boolean
}) {
  const [data, setData] = useState<AdminUserDetail | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [role, setRole] = useState('')
  const [active, setActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [signOutAll, setSignOutAll] = useState(false)
  const [signingOutAll, setSigningOutAll] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      const d = await api.getAdminUser(userId)
      setData(d)
      setRole(d.user.role)
      setActive(d.user.isActive)
      setErr(null)
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not load this user')
    }
  }, [userId])
  useEffect(() => { void load() }, [load])
  useRefreshHandler(load)

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

  async function saveRole() {
    setSaving(true)
    setMsg(null)
    try {
      await api.updateUser(userId, { role, isActive: active })
      await load()
      onChanged()
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not save' })
    } finally {
      setSaving(false)
    }
  }

  async function revokeAll() {
    setSigningOutAll(true)
    setMsg(null)
    try {
      const { revoked } = await api.revokeUserSessions(userId)
      await load()
      onChanged()
      setMsg({ ok: true, text: `Signed out ${revoked} ${revoked === 1 ? 'device' : 'devices'}` })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not sign them out' })
    } finally {
      setSigningOutAll(false)
      setSignOutAll(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      await api.deleteUser(userId)
      onChanged()
      onBack()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not delete' })
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (err) return <div className="settings-card danger"><span className="status-msg err">{err}</span></div>
  if (!data) return <div className="field-hint" style={{ padding: 24 }}>Loading…</div>

  const u = data.user
  const s: UserStats = data.stats
  const disk = s.photoBytes + s.originalBytes

  const dirty = role !== u.role || active !== u.isActive

  return (
    <>
      <SettingsCard title="Account">
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

        {/* Your own account is read-only here, and deliberately: an
            administrator cannot take their own role away, deactivate
            themselves, or delete themselves from this screen — account
            deletion lives under Settings behind an emailed code. Saying so
            beats rendering controls that can only end in an error. */}
        {isSelf ? (
          <p className="field-hint" style={{ marginBottom: 4 }}>
            This is your own account. Role, status and deletion are managed elsewhere.
          </p>
        ) : (
          <>
            <div className="admin-user-controls">
              <Field label="Role">
                <Dropdown block value={role} options={ROLE_OPTIONS} onChange={setRole} ariaLabel="Role" />
              </Field>
              <label className="switch">
                <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
                <span className="switch-track" />
                {active ? 'Active' : 'Inactive'}
              </label>
            </div>
            {isLastAdmin && (
              <p className="field-hint" style={{ marginTop: 8 }}>
                The only administrator who can sign in. Add a second one before changing this account.
              </p>
            )}
            <div className="settings-actions">
              <button className="btn btn-primary" onClick={() => void saveRole()} disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
              <StatusMsg msg={msg} />
            </div>
          </>
        )}

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
        <div className="admin-account-activity">
          {data.user.lastSeen && (
            <div className={`session-account-seen${isActiveNow(data.user.lastSeen) ? ' live' : ''}`}>
              <Circle size={7} fill="currentColor" strokeWidth={0} aria-hidden />
              {lastActive(data.user.lastSeen)}
            </div>
          )}
          <div className="field-hint">
            Last signed in {fmtDate(u.lastLoginAt) === '—' ? 'never' : fmtDate(u.lastLoginAt)}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title={`Active sessions (${data.sessions.length})`}
        actions={
          <button
            className="btn btn-ghost"
            onClick={() => setSignOutAll(true)}
            disabled={data.sessions.filter(x => !x.current).length === 0}
          >
            <LogOut size={14} /> Sign out all
          </button>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.sessions.length === 0 && (
            <span className="field-hint">This account has no active sessions.</span>
          )}
          {data.sessions.map(sess => (
            <SessionCard
              key={sess.id}
              session={sess}
              action={sess.current ? (
                /* The device this admin is using. Revoking it would end the
                   request's own session, so it is marked rather than offered. */
                <span className="badge" style={{ background: 'var(--primary-dim)', color: 'var(--primary)', flexShrink: 0 }}>
                  This device
                </span>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={() => setPending(sess.id)}
                  disabled={revoking === sess.id}
                  style={{ flexShrink: 0 }}
                >
                  <LogOut size={14} /> {revoking === sess.id ? 'Signing out…' : 'Sign out'}
                </button>
              )}
            />
          ))}
        </div>
      </SettingsCard>

      {!isSelf && (
        <SettingsCard title="Delete account">
          <p className="field-hint" style={{ marginBottom: 12 }}>
            Removes “{u.displayName || u.username}” and every workout, photo and piece of gear
            they own. This cannot be undone.
          </p>
          <button
            className="btn btn-ghost"
            style={{ color: 'var(--danger)' }}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} /> Delete this account
          </button>
        </SettingsCard>
      )}

      {signOutAll && (
        <ConfirmDialog
          title="Sign out every device?"
          message={<>
            Signs “{u.displayName || u.username}” out everywhere. They will need to sign in
            again on each device; nothing else about the account changes.
          </>}
          confirmLabel="Sign out all"
          busy={signingOutAll}
          busyLabel="Signing out…"
          onCancel={() => setSignOutAll(false)}
          onConfirm={() => void revokeAll()}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${u.displayName || u.username}?`}
          message="Their account and all of their workout data are removed. This cannot be undone."
          confirmLabel="Delete user"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          onConfirm={() => void remove()}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

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
