import { useState } from 'react'
import { Search, X } from 'lucide-react'
import PageHeader from '../../components/PageHeader'
import SettingsRow from '../../components/SettingsRow'
import SearchInput from '../../components/SearchInput'
import { isNative } from '../../lib/serverConfig'
import type { SettingsSection } from '../../lib/nav'
import { searchSettings } from '../../lib/settingsSearch'
import useDismissOnBack from '../../lib/useDismissOnBack'
import { SETTINGS_GROUPS, SETTINGS_META, sectionMeta } from './sections'

/** The settings landing page: categories grouped, each opening its own page. */
export default function SettingsHub({ onOpen, onOpenField }: {
  onOpen: (s: SettingsSection) => void
  /** Open a page and scroll to a specific setting within it. */
  onOpenField: (s: SettingsSection, anchor?: string) => void
}) {
  const native = isNative()
  const visible = SETTINGS_META.filter(s => !s.nativeOnly || native)

  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  // Only what this platform actually shows: the native-only pages are absent on
  // the web, so their settings must not surface in its search either.
  const results = searchSettings(query).filter(r => visible.some(v => v.id === r.section))
  const showResults = searching && query.trim() !== ''

  // Back and Escape leave search rather than the page, so the gesture undoes
  // opening search rather than dropping a level out of Settings.
  useDismissOnBack(searching, () => { setSearching(false); setQuery('') })

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Preferences for your account and this app"
        compactActions
        actions={
          <button
            className="btn-icon"
            onClick={() => { setSearching(s => !s); setQuery('') }}
            aria-label={searching ? 'Close search' : 'Search settings'}
            aria-pressed={searching}
            title="Search settings"
          >
            {searching ? <X size={18} /> : <Search size={18} />}
          </button>
        }
      />
      <div className="page-content settings-page">
        {searching && (
          <div className="settings-search">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search settings…"
              label="Search settings"
              autoFocus
            />
            {showResults && (
              <div className="settings-list settings-search-results">
                {results.length === 0 ? (
                  <p className="settings-search-empty">No settings match “{query}”.</p>
                ) : (
                  results.map(r => (
                    <SettingsRow
                      key={`${r.section}-${r.label}`}
                      icon={sectionMeta(r.section)?.icon}
                      label={r.label}
                      sub={r.sectionLabel}
                      onClick={() => onOpenField(r.section, r.anchor)}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {!showResults && (
          <div className="settings-groups">
            {SETTINGS_GROUPS.map(group => {
              const rows = visible.filter(s => s.group === group)
              if (rows.length === 0) return null
              return (
                <div className="settings-group" key={group}>
                  <span className="settings-group-title">{group}</span>
                  <div className="settings-list">
                    {rows.map(s => (
                      <SettingsRow
                        key={s.id}
                        icon={s.icon}
                        label={s.label}
                        sub={s.sub}
                        onClick={() => onOpen(s.id)}
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
