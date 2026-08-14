import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type AdminSettings, type AdminUser } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useRefreshHandler } from '../../context/RefreshContext'
import PageHeader from '../../components/PageHeader'
import SettingsRow from '../../components/SettingsRow'
import type { AdminSection } from '../../lib/nav'
import { ADMIN_META, adminMeta } from './sections'
import UsersAdmin from './Users'
import UserDetailAdmin from './UserDetail'
import FeedbackAdmin from './Feedback'
import EmailAdmin from './Email'
import SsoAdmin from './Sso'
import StorageAdmin from './Storage'

interface AdminProps {
  section: AdminSection | null
  /** The account open under Users, as it appears in the URL, or null. */
  userId: string | null
  onOpen: (s: AdminSection) => void
  /** Opens an account, or backs out of one with null. */
  onOpenUser: (id: number | null) => void
  onBack: () => void
}

/** Server administration: a hub of categories, matching Settings. */
export default function Admin({ section, userId: userParam, onOpen, onOpenUser, onBack }: AdminProps) {
  const { user: me } = useAuth()
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  /**
   * The account being inspected, or null for the list.
   *
   * It comes from the URL rather than local state: opening a workout or a
   * profile from here replaces the page, so a component holding the id unmounts
   * and the back gesture landed on the category list instead of the account.
   * The one back arrow in the page header still serves both levels — a second,
   * full-width button inside the content was what made drilling in look like a
   * different app.
   */
  const parsed = section === 'users' && userParam ? Number(userParam) : NaN
  const userId = Number.isInteger(parsed) ? parsed : null

  const load = useCallback(() => {
    api.getAdminSettings().then(setSettings).catch(e =>
      setLoadErr(e instanceof ApiError ? e.message : 'Failed to load settings'))
    api.listAdminUsers().then(r => setUsers(r.users)).catch(() => { /* ignore */ })
  }, [])
  useEffect(load, [load])
  // Admin fetches its own settings and user list; without this a pull here is
  // a gesture that visibly does nothing.
  useRefreshHandler(load)

  if (!section) {
    return (
      <>
        <PageHeader title="Admin" subtitle="Server configuration and user management" />
        <div className="page-content settings-page">
          {loadErr && <div className="settings-card danger"><span className="status-msg err">{loadErr}</span></div>}
          <div className="settings-list">
            {ADMIN_META.map(s => (
              <SettingsRow key={s.id} icon={s.icon} label={s.label} sub={s.sub} onClick={() => onOpen(s.id)} />
            ))}
          </div>
        </div>
      </>
    )
  }

  const meta = adminMeta(section)
  const openUser = userId !== null ? users.find(u => u.id === userId) : undefined
  const activeAdmins = users.filter(u => u.role === 'administrator' && u.isActive).length

  return (
    <>
      {/* One header for both levels: drilling into an account retitles it and
          points the same arrow one step back, exactly as drilling into a
          settings category does. */}
      <PageHeader
        title={openUser ? (openUser.displayName || openUser.username) : (meta?.label ?? 'Admin')}
        subtitle={openUser ? openUser.email : meta?.sub}
        onBack={openUser ? () => onOpenUser(null) : onBack}
      />
      <div className="page-content settings-page">
        {loadErr && <div className="settings-card danger"><span className="status-msg err">{loadErr}</span></div>}
        {section === 'users' && (userId !== null ? (
          <UserDetailAdmin
            userId={userId}
            onBack={() => onOpenUser(null)}
            onChanged={load}
            isSelf={userId === me?.id}
            isLastAdmin={openUser?.role === 'administrator' && openUser.isActive && activeAdmins <= 1}
          />
        ) : (
          <UsersAdmin users={users} onChanged={load} onOpenUser={onOpenUser} />
        ))}
        {section === 'feedback' && <FeedbackAdmin />}
        {/* The three server-config pages need the settings record; until it
            arrives there is nothing to render but the error above. */}
        {settings && section === 'email' && <EmailAdmin settings={settings} onSaved={setSettings} />}
        {settings && section === 'sso' && <SsoAdmin settings={settings} onSaved={setSettings} />}
        {settings && section === 'storage' && <StorageAdmin settings={settings} onSaved={setSettings} />}
      </div>
    </>
  )
}
