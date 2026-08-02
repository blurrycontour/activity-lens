import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { usePreferences } from '../../context/PreferencesContext'
import { ApiError } from '../../lib/api'
import { WORKOUT_TYPES } from '../../data/workouts'
import TypeIcon from '../../components/TypeIcon'
import { describeGoal, newGoal, type Goal } from '../../lib/insights'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'
import Dropdown, { type DropdownOption } from '../../components/Dropdown'

const MAX_GOALS = 12

const SPORT_OPTIONS: DropdownOption<string>[] = [
  { value: '', label: 'Any activity' },
  ...WORKOUT_TYPES.map(t => ({ value: t, label: t, glyph: <TypeIcon type={t} size={14} /> })),
]

const PERIOD_OPTIONS: DropdownOption<Goal['period']>[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

/** Targets the dashboard tracks a streak against. */
export default function GoalsSettings() {
  const { prefs, save } = usePreferences()
  const [goals, setGoals] = useState<Goal[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  useEffect(() => {
    if (!prefs) return
    setGoals((prefs.goals ?? []).map(g => ({
      id: g.id || Math.random().toString(36).slice(2, 10),
      count: g.count,
      period: g.period === 'month' ? 'month' : 'week',
      type: g.type as Goal['type'],
      minKm: g.minKm,
    })))
  }, [prefs])

  function update(index: number, patch: Partial<Goal>) {
    setGoals(prev => prev.map((g, i) => i === index ? { ...g, ...patch } : g))
  }

  async function onSave() {
    setBusy(true); setMsg(null)
    try {
      // Drop half-filled rows rather than rejecting the whole save.
      const kept = goals.filter(g => g.count > 0)
      setGoals(kept)
      await save({ goals: kept })
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBusy(false) }
  }

  const filled = goals.filter(g => g.count > 0)

  return (
    <SettingsCard
      title="Goals"
      description="A goal is a number of activities per week or month — say two runs of at least 5 km a week. Each is tracked as its own streak."
    >
      {goals.length === 0 && (
        <span className="field-hint">No goals yet. Add one to start tracking a streak.</span>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {goals.map((g, i) => (
          <div key={g.id} className="goal-row">
            <Field label="How many">
              <input
                className="input" type="number" min="1" max="93" style={{ width: '100%' }}
                value={g.count || ''}
                onChange={e => update(i, { count: Number(e.target.value) || 0 })}
              />
            </Field>
            <Field label="Sport">
              <Dropdown
                block
                value={g.type ?? ''}
                options={SPORT_OPTIONS}
                onChange={v => update(i, { type: v as Goal['type'] })}
                ariaLabel="Sport"
              />
            </Field>
            <Field label="Per">
              <Dropdown
                block
                value={g.period}
                options={PERIOD_OPTIONS}
                onChange={v => update(i, { period: v })}
                ariaLabel="Period"
              />
            </Field>
            <Field label="Min km">
              <input
                className="input" type="number" min="0" step="0.5" placeholder="any" style={{ width: '100%' }}
                value={g.minKm || ''}
                onChange={e => update(i, { minKm: Number(e.target.value) || 0 })}
              />
            </Field>
            <button
              className="btn-icon"
              onClick={() => setGoals(prev => prev.filter((_, j) => j !== i))}
              title="Remove goal"
              aria-label="Remove goal"
              style={{ alignSelf: 'end', marginBottom: 1, color: 'var(--danger)' }}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      <div className="settings-actions">
        <button className="btn btn-ghost" onClick={() => setGoals(prev => [...prev, newGoal()])} disabled={goals.length >= MAX_GOALS}>
          <Plus size={14} /> Add goal
        </button>
        <button className="btn btn-primary" onClick={onSave} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <StatusMsg msg={msg} />
      </div>

      {filled.length > 0 && (
        <span className="field-hint">{filled.map(describeGoal).join(' · ')}</span>
      )}
    </SettingsCard>
  )
}
