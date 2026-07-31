import PageHeader from '../../components/PageHeader'
import SettingsRow from '../../components/SettingsRow'
import { isNative } from '../../lib/serverConfig'
import type { SettingsSection } from '../../lib/nav'
import { SETTINGS_GROUPS, SETTINGS_META } from './sections'

/** The settings landing page: categories grouped, each opening its own page. */
export default function SettingsHub({ onOpen }: { onOpen: (s: SettingsSection) => void }) {
  const native = isNative()
  const visible = SETTINGS_META.filter(s => !s.nativeOnly || native)

  return (
    <>
      <PageHeader title="Settings" subtitle="Preferences for your account and this app" />
      <div className="page-content settings-page">
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
      </div>
    </>
  )
}
