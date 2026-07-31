import { useState } from 'react'
import { Check, Lock, Pencil, Plus, Trash2, X as XIcon } from 'lucide-react'
import { api, ApiError, type AdminUser } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import PasswordInput from '../../components/PasswordInput'
import ConfirmDialog from '../../components/ConfirmDialog'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'

const ROLES = ['administrator', 'editor', 'reader']

function fmtDate(iso: string) {
  if (!iso) return 'Never'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

interface Props {
  users: AdminUser[]
  onChanged: () => void
}

export default function UsersAdmin({ users, onChanged }: Props) {
  const { user: me } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draftRole, setDraftRole] = useState('')
  const [draftActive, setDraftActive] = useState(true)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [pendingDelete, setPendingDelete] = useState<AdminUser | null>(null)
  const [deleting, setDeleting] = useState(false)

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

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true); setMsg(null)
    try {
      await api.deleteUser(pendingDelete.id)
      setPendingDelete(null)
      onChanged()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Delete failed' })
    } finally { setDeleting(false) }
  }

  return (
    <>
      <SettingsCard
        title={`Users (${users.length})`}
        actions={
          showCreate ? (
            <button className="btn btn-ghost" onClick={() => setShowCreate(false)}>
              <XIcon size={14} /> Cancel
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Add user
            </button>
          )
        }
      >
        {showCreate && <CreateUser onDone={() => { setShowCreate(false); onChanged() }} onCancel={() => setShowCreate(false)} />}
        <StatusMsg msg={msg} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {users.map(u => {
            const editing = editingId === u.id
            return (
              <div key={u.id} className="user-row">
                <div className="user-row-who">
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.displayName || u.username}
                  </div>
                  <div className="field-hint" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.email}</span>
                    {!u.hasPassword && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                        <Lock size={10} /> SSO
                      </span>
                    )}
                  </div>
                </div>

                <div className="user-row-role">
                  {editing ? (
                    <select className="select" style={{ width: '100%' }} value={draftRole} onChange={e => setDraftRole(e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textTransform: 'capitalize' }}>
                      {u.role}
                      {/* Marks the account the instance cannot afford to lose.
                          Purely informational — an icon rather than a tooltip
                          alone so it still reads on a touch device. */}
                      {isLastActiveAdmin(u) && (
                        <span title="The only administrator who can sign in. Add a second one before changing this account." style={{ display: 'inline-flex', color: 'var(--text-3)' }}>
                          <Lock size={11} />
                        </span>
                      )}
                    </span>
                  )}
                </div>

                <div className="user-row-state">
                  {editing ? (
                    <label className="switch">
                      <input type="checkbox" checked={draftActive} onChange={e => setDraftActive(e.target.checked)} />
                      <span className="switch-track" />
                      {draftActive ? 'Active' : 'Inactive'}
                    </label>
                  ) : (
                    <span className={`badge ${u.isActive ? 'badge-ok' : 'badge-off'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  )}
                </div>

                <div className="user-row-seen field-hint">{fmtDate(u.lastLoginAt)}</div>

                <div className="user-row-actions">
                  {editing ? (
                    <>
                      <button className="btn btn-primary" onClick={() => saveEdit(u)} title="Save"><Check size={14} /></button>
                      <button className="btn btn-ghost" onClick={() => setEditingId(null)} title="Cancel"><XIcon size={14} /></button>
                    </>
                  ) : u.id === me?.id ? (
                    /* Your own row carries no actions at all. Neither field is
                       changeable on it: an administrator cannot take their own
                       role away, cannot deactivate themselves, and cannot delete
                       themselves from here — account deletion lives under
                       Settings, behind an emailed confirmation code. Rendering
                       the buttons disabled, or worse enabled, only invites a
                       click that can end in an error. */
                    <span className="field-hint">This is you</span>
                  ) : (
                    <>
                      <button className="btn btn-ghost" onClick={() => startEdit(u)} title="Edit user" aria-label={`Edit ${u.username}`}>
                        <Pencil size={14} />
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => setPendingDelete(u)}
                        title="Delete user"
                        aria-label={`Delete ${u.username}`}
                        style={{ color: 'var(--danger)' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </SettingsCard>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.displayName || pendingDelete.username}?`}
          message="Their account and all of their workout data are removed. This cannot be undone."
          confirmLabel="Delete user"
          busyLabel="Deleting…"
          busy={deleting}
          danger
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
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
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
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
          <select className="select" style={{ width: '100%' }} value={role} onChange={e => setRole(e.target.value)}>
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </Field>
      </div>
      <div className="settings-actions">
        <button className="btn btn-primary" onClick={create} disabled={busy}>{busy ? 'Creating…' : 'Create user'}</button>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <StatusMsg msg={msg} />
      </div>
    </div>
  )
}
