import {
  User as UserIcon, ShieldCheck, HeartPulse, Palette, LayoutDashboard,
  Target, Bell, CloudSun, FolderSync, Server, Smartphone, MessageSquare,
  ClipboardList,
} from 'lucide-react'
import type { SettingsSection } from '../../lib/nav'

export interface SectionMeta {
  id: SettingsSection
  label: string
  /** One line for the hub row and the category page's subtitle. */
  sub: string
  icon: React.ReactNode
  group: 'You' | 'App' | 'This device'
  /** Only shown in the Android app — the web has no answer for these. */
  nativeOnly?: boolean
}

/**
 * Every settings category, in the order the hub lists them.
 *
 * Grouped by what the setting belongs to rather than by which page it used to
 * live on: "About you" was in Settings while "Profile" was in Account, and both
 * are you.
 */
export const SETTINGS_META: SectionMeta[] = [
  {
    id: 'profile', label: 'Profile', group: 'You',
    sub: 'Name, email and picture',
    icon: <UserIcon size={16} />,
  },
  {
    id: 'security', label: 'Security', group: 'You',
    sub: 'Password and signed-in devices',
    icon: <ShieldCheck size={16} />,
  },
  {
    id: 'body', label: 'Body & performance', group: 'You',
    sub: 'Metrics behind calorie and zone estimates',
    icon: <HeartPulse size={16} />,
  },
  {
    id: 'appearance', label: 'Appearance', group: 'App',
    sub: 'Theme, readability, accent colour and charts',
    icon: <Palette size={16} />,
  },
  {
    id: 'dashboard', label: 'Dashboard', group: 'App',
    sub: 'Which cards show and over what period',
    icon: <LayoutDashboard size={16} />,
  },
  {
    id: 'goals', label: 'Training goals', group: 'App',
    sub: 'Targets the dashboard tracks streaks for',
    icon: <Target size={16} />,
  },
  {
    id: 'notifications', label: 'Notifications', group: 'App',
    sub: 'What you hear about, and how',
    icon: <Bell size={16} />,
  },
  {
    id: 'plans', label: 'Training plans', group: 'App',
    sub: 'What happens when a session finishes',
    icon: <ClipboardList size={16} />,
  },
  {
    id: 'weather', label: 'Weather', group: 'App',
    sub: 'Conditions recorded with each workout',
    icon: <CloudSun size={16} />,
  },
  {
    id: 'feedback', label: 'Send feedback', group: 'App',
    sub: 'Report a bug or suggest something',
    icon: <MessageSquare size={16} />,
  },
  {
    id: 'autoimport', label: 'Auto import', group: 'This device',
    sub: 'Watch a folder for new activity files',
    icon: <FolderSync size={16} />, nativeOnly: true,
  },
  {
    id: 'app', label: 'App', group: 'This device',
    sub: 'Version and updates',
    icon: <Smartphone size={16} />, nativeOnly: true,
  },
  // Last on purpose: disconnecting is the one action here that signs you out.
  {
    id: 'server', label: 'Server', group: 'This device',
    sub: 'Which instance this app is connected to',
    icon: <Server size={16} />, nativeOnly: true,
  },
]

export const SETTINGS_GROUPS: SectionMeta['group'][] = ['You', 'App', 'This device']

export function sectionMeta(id: string): SectionMeta | undefined {
  return SETTINGS_META.find(s => s.id === id)
}
