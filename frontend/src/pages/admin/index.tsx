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
  onOpen: (s: AdminSection) => void
  onBack: () => void
}

/** Server administration: a hub of categories, matching Settings. */
export default function Admin({ section, onOpen, onBack }: AdminProps) {
  const { user: me } = useAuth()
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)
  /**
   * The account being inspected, or null for the list.
   *
   * Held here rather than inside the users page so the one back arrow in the
   * page header can serve both levels — a second, full-width button inside the
   * content was what made drilling in look like a different app.
   */
  const [userId, setUserId] = useState<number | null>(null)

  const load = useCallback(() => {
    api.getAdminSettings().then(setSettings).catch(e =>
      setLoadErr(e instanceof ApiError ? e.message : 'Failed to load settings'))
    api.listAdminUsers().then(r => setUsers(r.users)).catch(() => { /* ignore */ })
  }, [])
  useEffect(load, [load])
  // Admin fetches its own settings and user list; without this a pull here is
  // a gesture that visibly does nothing.
  useRefreshHandler(load)

  // Leaving Users must not leave an account open behind it, or coming back
  // lands on whoever was last inspected rather than on the list.
  useEffect(() => { if (section !== 'users') setUserId(null) }, [section])

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
  const openUser = section === 'users' && userId !== null
    ? users.find(u => u.id === userId)
    : undefined
  const activeAdmins = users.filter(u => u.role === 'administrator' && u.isActive).length

  return (
    <>
      {/* One header for both levels: drilling into an account retitles it and
          points the same arrow one step back, exactly as drilling into a
          settings category does. */}
      <PageHeader
        title={openUser ? (openUser.displayName || openUser.username) : (meta?.label ?? 'Admin')}
        subtitle={openUser ? openUser.email : meta?.sub}
        onBack={openUser ? () => setUserId(null) : onBack}
      />
      <div className="page-content settings-page">
        {loadErr && <div className="settings-card danger"><span className="status-msg err">{loadErr}</span></div>}
        {section === 'users' && (userId !== null ? (
          <UserDetailAdmin
            userId={userId}
            onBack={() => setUserId(null)}
            onChanged={load}
            isSelf={userId === me?.id}
            isLastAdmin={openUser?.role === 'administrator' && openUser.isActive && activeAdmins <= 1}
          />
        ) : (
          <UsersAdmin users={users} onChanged={load} onOpenUser={setUserId} />
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
