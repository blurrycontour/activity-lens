import { useCallback, useEffect, useState } from 'react'
import { api, ApiError, type AdminSettings, type AdminUser } from '../../lib/api'
import PageHeader from '../../components/PageHeader'
import SettingsRow from '../../components/SettingsRow'
import type { AdminSection } from '../../lib/nav'
import { ADMIN_META, adminMeta } from './sections'
import UsersAdmin from './Users'
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
  const [settings, setSettings] = useState<AdminSettings | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const load = useCallback(() => {
    api.getAdminSettings().then(setSettings).catch(e =>
      setLoadErr(e instanceof ApiError ? e.message : 'Failed to load settings'))
    api.listAdminUsers().then(r => setUsers(r.users)).catch(() => { /* ignore */ })
  }, [])
  useEffect(load, [load])

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

  return (
    <>
      <PageHeader title={meta?.label ?? 'Admin'} subtitle={meta?.sub} onBack={onBack} />
      <div className="page-content settings-page">
        {loadErr && <div className="settings-card danger"><span className="status-msg err">{loadErr}</span></div>}
        {section === 'users' && <UsersAdmin users={users} onChanged={load} />}
        {/* The three server-config pages need the settings record; until it
            arrives there is nothing to render but the error above. */}
        {settings && section === 'email' && <EmailAdmin settings={settings} onSaved={setSettings} />}
        {settings && section === 'sso' && <SsoAdmin settings={settings} onSaved={setSettings} />}
        {settings && section === 'storage' && <StorageAdmin settings={settings} onSaved={setSettings} />}
      </div>
    </>
  )
}
