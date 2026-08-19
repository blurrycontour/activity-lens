import { Grid2X2, List } from 'lucide-react'

export type ListView = 'list' | 'grid'

/**
 * The list/grid toggle, in one place.
 *
 * It was inline markup and inline colours inside Workouts, which is why the
 * Plans page could not have one without a second copy of the same eight lines
 * of style. The rows and cards each page draws are its own business; the
 * control that swaps between them is not.
 */
export default function ViewSwitcher({ view, onChange }: {
  view: ListView
  onChange: (v: ListView) => void
}) {
  return (
    <div className="view-switch" role="group" aria-label="List layout">
      {([['list', <List key="l" size={15} />], ['grid', <Grid2X2 key="g" size={15} />]] as const).map(([id, icon]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          title={id === 'list' ? 'List view' : 'Card view'}
          aria-label={id === 'list' ? 'List view' : 'Card view'}
          aria-pressed={view === id}
          className={view === id ? 'active' : undefined}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}

/**
 * The remembered choice for one list, per device.
 *
 * A layout preference belongs to the screen it is read on — a grid that suits
 * a wide monitor is not the one that suits a phone — so it lives in
 * localStorage beside the theme rather than on the account.
 */
export function readView(key: string): ListView {
  try {
    return localStorage.getItem(key) === 'grid' ? 'grid' : 'list'
  } catch {
    return 'list'
  }
}

export function writeView(key: string, v: ListView) {
  try {
    localStorage.setItem(key, v)
  } catch { /* nothing depends on it */ }
}
