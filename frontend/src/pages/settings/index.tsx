import { useEffect, useRef } from 'react'
import PageHeader from '../../components/PageHeader'
import AutoImportCard from '../../components/AutoImportCard'
import type { SettingsSection } from '../../lib/nav'
import type { ThemeMode } from '../../components/TopBar'
import { sectionMeta } from './sections'
import SettingsHub from './Hub'
import ProfileSettings from './Profile'
import SecuritySettings from './Security'
import BodySettings from './Body'
import AppearanceSettings from './Appearance'
import type { DisplayPrefs } from '../../lib/theme'
import DashboardSettings from './DashboardPrefs'
import GoalsSettings from './Goals'
import NotificationSettings from './Notifications'
import WeatherSettings from './Weather'
import PlansSettings from './Plans'
import FeedbackSettings from './Feedback'
import AppInfoSettings from './AppInfo'
import ServerSettings from './Server'

interface SettingsProps {
  /** The open category, or null for the hub. */
  section: SettingsSection | null
  onOpen: (s: SettingsSection) => void
  onBack: () => void
  accent: string
  onAccentChange: (a: string) => void
  themeMode: ThemeMode
  onThemeChange: (m: ThemeMode) => void
  display: DisplayPrefs
  onDisplayChange: (d: DisplayPrefs) => void
  /** Opens the caller's own public profile, from the tagline card. */
  onViewProfile?: () => void
}

/**
 * Settings: a hub of categories, each its own page.
 *
 * Drilling in replaces the page rather than opening a pane, so the interaction
 * is the one people already know from opening a workout, and desktop and mobile
 * share a single code path.
 */
export default function Settings({ section, onOpen, onBack, accent, onAccentChange, themeMode, onThemeChange, display, onDisplayChange, onViewProfile }: SettingsProps) {
  // Set when a search result is chosen, read once the target page has rendered.
  const focus = useRef<string | null>(null)
  useEffect(() => {
    const anchor = focus.current
    if (!anchor || !section) return
    focus.current = null
    const t = window.setTimeout(() => {
      const el = document.getElementById(`setting-${anchor}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('setting-flash')
      window.setTimeout(() => el.classList.remove('setting-flash'), 1800)
    }, 80)
    return () => window.clearTimeout(t)
  }, [section])

  if (!section) return (
    <SettingsHub
      onOpen={onOpen}
      onOpenField={(s, anchor) => { focus.current = anchor ?? null; onOpen(s) }}
    />
  )

  const meta = sectionMeta(section)

  const body = (
    <>
      {section === 'profile' && <ProfileSettings onViewProfile={onViewProfile} />}
      {section === 'security' && <SecuritySettings />}
      {section === 'body' && <BodySettings />}
      {section === 'appearance' && (
        <AppearanceSettings
          accent={accent}
          onAccentChange={onAccentChange}
          themeMode={themeMode}
          onThemeChange={onThemeChange}
          display={display}
          onDisplayChange={onDisplayChange}
        />
      )}
      {section === 'dashboard' && <DashboardSettings />}
      {section === 'goals' && <GoalsSettings />}
      {section === 'notifications' && <NotificationSettings />}
      {section === 'plans' && <PlansSettings />}
      {section === 'weather' && <WeatherSettings />}
      {section === 'feedback' && <FeedbackSettings />}
      {section === 'autoimport' && <AutoImportCard />}
      {section === 'app' && <AppInfoSettings />}
      {section === 'server' && <ServerSettings />}
    </>
  )

  return (
    <>
      <PageHeader title={meta?.label ?? 'Settings'} subtitle={meta?.sub} onBack={onBack} />
      {/* Goals is a form of seven controls per row; every other category is
          prose-width. */}
      <div className={`page-content settings-page${section === 'goals' ? ' wide' : ''}`}>
        {body}
      </div>
    </>
  )
}
