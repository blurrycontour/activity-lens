import PageHeader from '../../components/PageHeader'
import AutoImportCard from '../../components/AutoImportCard'
import { PreferencesProvider } from '../../context/PreferencesContext'
import type { SettingsSection } from '../../lib/nav'
import { sectionMeta } from './sections'
import SettingsHub from './Hub'
import ProfileSettings from './Profile'
import SecuritySettings from './Security'
import BodySettings from './Body'
import AppearanceSettings from './Appearance'
import DashboardSettings from './DashboardPrefs'
import GoalsSettings from './Goals'
import NotificationSettings from './Notifications'
import AppInfoSettings from './AppInfo'
import ServerSettings from './Server'

interface SettingsProps {
  /** The open category, or null for the hub. */
  section: SettingsSection | null
  onOpen: (s: SettingsSection) => void
  onBack: () => void
  accent: string
  onAccentChange: (a: string) => void
}

/**
 * Settings: a hub of categories, each its own page.
 *
 * Drilling in replaces the page rather than opening a pane, so the interaction
 * is the one people already know from opening a workout, and desktop and mobile
 * share a single code path.
 */
/** The categories backed by the server-side preferences record. */
const NEEDS_PREFS: SettingsSection[] = ['body', 'goals', 'notifications']

export default function Settings({ section, onOpen, onBack, accent, onAccentChange }: SettingsProps) {
  if (!section) return <SettingsHub onOpen={onOpen} />

  const meta = sectionMeta(section)

  const body = (
    <>
      {section === 'profile' && <ProfileSettings />}
      {section === 'security' && <SecuritySettings />}
      {section === 'body' && <BodySettings />}
      {section === 'appearance' && <AppearanceSettings accent={accent} onAccentChange={onAccentChange} />}
      {section === 'dashboard' && <DashboardSettings />}
      {section === 'goals' && <GoalsSettings />}
      {section === 'notifications' && <NotificationSettings />}
      {section === 'autoimport' && <AutoImportCard />}
      {section === 'app' && <AppInfoSettings />}
      {section === 'server' && <ServerSettings />}
    </>
  )

  return (
    <>
      <PageHeader title={meta?.label ?? 'Settings'} subtitle={meta?.sub} onBack={onBack} />
      <div className="page-content settings-page">
        {/* Only the categories that read preferences pay for the fetch. The hub
            and the local-only pages (appearance, dashboard) never ask. */}
        {NEEDS_PREFS.includes(section)
          ? <PreferencesProvider>{body}</PreferencesProvider>
          : body}
      </div>
    </>
  )
}
