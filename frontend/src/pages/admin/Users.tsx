import { useState } from 'react'
import { ChevronRight, Lock, Plus } from 'lucide-react'
import { api, ApiError, type AdminUser } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import PasswordInput from '../../components/PasswordInput'
import UserAvatar from '../../components/UserAvatar'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'
import Dropdown, { type DropdownOption } from '../../components/Dropdown'
import { fmtBytes } from './UserDetail'
import BroadcastAdmin from './Broadcast'
import Modal from '../../components/Modal'

const ROLES = ['administrator', 'editor', 'reader']

const ROLE_OPTIONS: DropdownOption<string>[] = ROLES.map(r => ({
  value: r,
  label: r.charAt(0).toUpperCase() + r.slice(1),
}))

interface Props {
  users: AdminUser[]
  onChanged: () => void
  /** Opens one account. The hub owns which, so the page header can carry the
      back arrow rather than this page growing a second one. */
  onOpenUser: (id: number) => void
}

export default function UsersAdmin({ users, onChanged, onOpenUser }: Props) {
  const { user: me } = useAuth()
  const [showCreate, setShowCreate] = useState(false)

  const activeAdminCount = users.filter(u => u.role === 'administrator' && u.isActive).length

  /**
   * Whether this account is the only administrator who can still sign in.
   *
   * Only used to mark the row. Losing this account would lock everyone out of
   * user management, SSO and email settings with no screen left that could hand
   * the role back, so it is worth flagging — but it needs no controls disabling
   * of its own, because the last active administrator is always whoever is
   * looking at this page, and your own row is read-only here regardless.
   *
   * Inactive administrators are not counted: they cannot sign in, so they are
   * no help in getting back in.
   */
  function isLastActiveAdmin(u: AdminUser): boolean {
    return u.role === 'administrator' && u.isActive && activeAdminCount <= 1
  }

  return (
    <>
      <SettingsCard
        title={`Users (${users.length})`}
        actions={
          <button className="btn btn-accent" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> Add user
          </button>
        }
      >

        <div className="admin-user-list">
          {users.map(u => (
            /* The whole row opens the account. Editing a role, deactivating and
               deleting all moved onto that page: five controls crowded into a
               scannable list is what made this incoherent, and none of them is
               something you do without looking at the account first. */
            <button
              key={u.id}
              type="button"
              className="admin-user-row"
              onClick={() => onOpenUser(u.id)}
            >
              <UserAvatar user={u} size={36} />

              <span className="admin-user-main">
                <span className="admin-user-name">
                  {u.displayName || u.username}
                  {u.id === me?.id && <span className="admin-user-you">You</span>}
                </span>
                <span className="admin-user-email">{u.email}</span>
                {/* Under the email and above the figures: what this account
                    *is* reads before what it has done, and on a phone the
                    badges get a line of their own rather than being pushed
                    below the storage totals by a name that wrapped. */}
                <span className="admin-user-tags">
                  <span className={`badge role-${u.role}`}>
                    {u.role}
                    {isLastActiveAdmin(u) && (
                      <span title="The only administrator who can sign in. Add a second one before changing this account.">
                        <Lock size={10} />
                      </span>
                    )}
                  </span>
                  {!u.isActive && <span className="badge badge-off">Inactive</span>}
                  {!u.hasPassword && (
                    <span className="admin-user-sso" title="Signs in through the identity provider">
                      <Lock size={10} /> SSO
                    </span>
                  )}
                </span>
                {/* At list resolution: enough to spot the account worth
                    opening. Absent stats mean the totals could not be
                    computed, which is not the same as zero. */}
                {u.stats && (
                  <span className="admin-user-stats">
                    <span>{u.stats.workouts} workouts</span>
                    <span>{fmtBytes(u.stats.photoBytes + u.stats.originalBytes)}</span>
                    <span>{u.stats.equipment} {u.stats.equipment === 1 ? 'item' : 'items'}</span>
                  </span>
                )}
              </span>

              {(u.sessions ?? 0) > 0 && (
                <span className="admin-user-seen">{u.sessions} {u.sessions === 1 ? 'device' : 'devices'}</span>
              )}

              <ChevronRight size={16} className="admin-user-chevron" />
            </button>
          ))}
        </div>
      </SettingsCard>

      {/* A dialog rather than a form unfolding above the list: creating an
          account is a detour with its own start and end, and opening it in
          place pushed every row down the page mid-scroll. */}
      {showCreate && (
        <CreateUser onDone={() => { setShowCreate(false); onChanged() }} onCancel={() => setShowCreate(false)} />
      )}

      {/* Under the list because it is about all of them, and because the list
          is what an admin came here for. */}
      <BroadcastAdmin recipients={users.filter(u => u.isActive && u.id !== me?.id).length} />

    </>
  )
}

function CreateUser({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('reader')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  async function create() {
    setBusy(true); setMsg(null)
    try {
      await api.createUser({
        username: username.trim(), email: email.trim(),
        displayName: displayName.trim(), password, role,
      })
      onDone()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Create failed' })
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onCancel} dismissable={!busy} label="Add user">
        <div className="modal-box" style={{ maxWidth: 520 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 14 }}>Add user</h3>
          <div className="field-grid">
        <Field label="Username">
          <input className="input" style={{ width: '100%' }} value={username} onChange={e => setUsername(e.target.value)} />
        </Field>
        <Field label="Email">
          <input className="input" type="email" style={{ width: '100%' }} value={email} onChange={e => setEmail(e.target.value)} />
        </Field>
        <Field label="Display name">
          <input className="input" style={{ width: '100%' }} value={displayName} onChange={e => setDisplayName(e.target.value)} />
        </Field>
        <Field label="Password">
          <PasswordInput autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} />
        </Field>
            <Field label="Role">
              <Dropdown block value={role} options={ROLE_OPTIONS} onChange={setRole} ariaLabel="Role" />
            </Field>
          </div>
          <StatusMsg msg={msg} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="btn btn-primary" onClick={create} disabled={busy || !username.trim() || !password}>
              {busy ? 'Creating…' : 'Create user'}
            </button>
          </div>
        </div>
    </Modal>
  )
}
