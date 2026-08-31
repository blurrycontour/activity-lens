import type { SettingsSection } from './nav'
import { sectionMeta } from '../pages/settings/sections'

/** One searchable setting: where it lives, and how to find it. */
export interface SettingsSearchItem {
  section: SettingsSection
  label: string
  /** Card or field id within the page (`setting-<anchor>`); scrolled to and
      flashed on open. Absent means "just open the page". */
  anchor?: string
  /** Extra words a person might search by that aren't in the label. */
  keywords?: string
}

/**
 * The searchable settings, curated rather than derived.
 *
 * Deriving this from the rendered pages would mean every field carrying its own
 * search metadata; a hand-kept list is a few lines and lets a setting be found
 * by words that never appear on screen ("Karvonen", "OLED"). Each `anchor`
 * matches an `anchorId` on a SettingsCard or Field in the named section.
 */
const ITEMS: SettingsSearchItem[] = [
  { section: 'body', label: 'HR zone model', anchor: 'hr-zone-model', keywords: 'karvonen max heart rate reserve zones percentage method' },
  { section: 'body', label: 'Max HR', anchor: 'thresholds', keywords: 'maximum heart rate bpm' },
  { section: 'body', label: 'Resting HR', anchor: 'thresholds', keywords: 'resting heart rate bpm' },
  { section: 'body', label: 'Threshold pace', anchor: 'thresholds', keywords: 'pace min per km' },
  { section: 'body', label: 'FTP', anchor: 'thresholds', keywords: 'functional threshold power cycling watts' },
  { section: 'body', label: 'Body weight', anchor: 'about-you', keywords: 'weight kg mass' },
  { section: 'body', label: 'Sex', anchor: 'about-you', keywords: 'gender male female' },
  { section: 'body', label: 'Birth year', anchor: 'about-you', keywords: 'age date of birth' },
  { section: 'body', label: 'Height', anchor: 'about-you', keywords: 'cm tall' },
  { section: 'body', label: 'Step length', anchor: 'about-you', keywords: 'steps stride estimate' },
  { section: 'body', label: 'Calorie estimation', anchor: 'calories', keywords: 'calories kcal energy method' },
  { section: 'appearance', label: 'Theme', anchor: 'theme', keywords: 'dark light system mode appearance' },
  { section: 'appearance', label: 'Pure black', anchor: 'readability', keywords: 'oled power glare surfaces' },
  { section: 'appearance', label: 'High contrast', anchor: 'readability', keywords: 'accessibility outdoor readable text' },
  { section: 'appearance', label: 'Accent colour', anchor: 'accent', keywords: 'color highlight green blue orange violet cyan rose' },
  { section: 'appearance', label: 'Heart-rate zones chart', anchor: 'charts', keywords: 'histogram donut pie zones style' },
  { section: 'appearance', label: 'Mark peaks on charts', anchor: 'charts', keywords: 'min max markers triangles peaks highest lowest trends efficiency workout' },
  { section: 'dashboard', label: 'Dashboard cards', keywords: 'stats period which cards show' },
  { section: 'goals', label: 'Training goals', keywords: 'targets streaks weekly monthly distance' },
  { section: 'notifications', label: 'Notifications', keywords: 'push alerts email what you hear about' },
  { section: 'plans', label: 'Training plans', keywords: 'session finish record strength workout' },
  { section: 'weather', label: 'Weather', keywords: 'conditions open-meteo temperature humidity' },
  { section: 'profile', label: 'Profile', keywords: 'name email picture tagline avatar' },
  { section: 'security', label: 'Security', keywords: 'password change devices sessions sign out' },
  { section: 'feedback', label: 'Send feedback', keywords: 'bug report suggest contact' },
  { section: 'autoimport', label: 'Auto import', keywords: 'watch folder new activity files this device' },
  { section: 'app', label: 'App version', keywords: 'version updates about build this device' },
  { section: 'server', label: 'Server', keywords: 'instance connection url disconnect this device' },
]

/** Items whose label, keywords or category name match every word in `query`. */
export function searchSettings(query: string): (SettingsSearchItem & { sectionLabel: string })[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const terms = q.split(/\s+/)
  return ITEMS
    .map(it => {
      const sectionLabel = sectionMeta(it.section)?.label ?? it.section
      const hay = `${it.label} ${it.keywords ?? ''} ${sectionLabel}`.toLowerCase()
      const rank = terms.every(t => hay.includes(t)) ? hay.indexOf(terms[0]) : -1
      return { it: { ...it, sectionLabel }, rank }
    })
    .filter(x => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 12)
    .map(x => x.it)
}
