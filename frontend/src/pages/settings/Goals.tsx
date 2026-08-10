import { useEffect, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { usePreferences } from '../../context/PreferencesContext'
import { ApiError } from '../../lib/api'
import { WORKOUT_TYPES } from '../../data/workouts'
import TypeIcon from '../../components/TypeIcon'
import {
  MAX_GOAL_SPAN, describeGoal, goalFromApi, newGoal, type Goal,
} from '../../lib/insights'
import {
  DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG, GOAL_STYLES, type DashboardConfig,
} from '../../lib/dashboardConfig'
import { useLocalStorage } from '../../lib/useLocalStorage'
import SettingsCard from '../../components/SettingsCard'
import ConfirmDialog from '../../components/ConfirmDialog'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'
import Dropdown, { type DropdownOption } from '../../components/Dropdown'

const MAX_GOALS = 12

const SPORT_OPTIONS: DropdownOption<string>[] = [
  { value: '', label: 'Any activity' },
  ...WORKOUT_TYPES.map(t => ({ value: t, label: t, glyph: <TypeIcon type={t} size={14} /> })),
]

const METRIC_OPTIONS: DropdownOption<Goal['metric']>[] = [
  { value: 'count', label: 'times' },
  { value: 'distance', label: 'km' },
  { value: 'duration', label: 'hours' },
]

const PERIOD_OPTIONS: DropdownOption<Goal['period']>[] = [
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
]

/** Targets the dashboard tracks a streak against, in the order shown there. */
export default function GoalsSettings() {
  const { prefs, save } = usePreferences()
  // Display options are device-local, like the theme and the dashboard cards —
  // they apply instantly and deliberately sit outside the Save button below,
  // which owns the goals themselves.
  const [cfg, setCfg] = useLocalStorage<DashboardConfig>(DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG)
  const [goals, setGoals] = useState<Goal[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)
  const [removing, setRemoving] = useState<Goal | null>(null)

  useEffect(() => {
    if (!prefs) return
    setGoals((prefs.goals ?? []).map(goalFromApi))
  }, [prefs])

  function update(index: number, patch: Partial<Goal>) {
    setGoals(prev => prev.map((g, i) => i === index ? { ...g, ...patch } : g))
  }

  /** Swaps a goal with its neighbour; the list order is the dashboard order. */
  function move(index: number, by: -1 | 1) {
    setGoals(prev => {
      const to = index + by
      if (to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[index], next[to]] = [next[to], next[index]]
      return next
    })
  }

  async function onSave() {
    setBusy(true); setMsg(null)
    try {
      // Drop half-filled rows rather than rejecting the whole save.
      const kept = goals.filter(g => g.target > 0)
      setGoals(kept)
      await save({ goals: kept })
      setMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBusy(false) }
  }

  const filled = goals.filter(g => g.target > 0)

  return (
    <>
    <SettingsCard
      title="Goals"
      description="A goal is a number of activities, kilometres or hours per window of time — two runs a week, or 40 km of hiking a month. Each is tracked as its own streak, in the order listed here."
    >
      {goals.length === 0 && (
        <span className="field-hint">No goals yet. Add one to start tracking a streak.</span>
      )}

      <div className="goal-rows">
        {goals.map((g, i) => (
          <div key={g.id} className="goal-row">
            <div className="goal-move">
              <button
                className="btn-icon" onClick={() => move(i, -1)} disabled={i === 0}
                title="Move up" aria-label={`Move goal ${i + 1} up`}
              >
                <ChevronUp size={14} />
              </button>
              <button
                className="btn-icon" onClick={() => move(i, 1)} disabled={i === goals.length - 1}
                title="Move down" aria-label={`Move goal ${i + 1} down`}
              >
                <ChevronDown size={14} />
              </button>
            </div>

            <Field label="Target" info="What this goal measures: a number of activities, total kilometres, or total hours.">
              <div className="goal-pair">
                <input
                  className="input" type="number" min="0" step={g.metric === 'count' ? 1 : 0.5}
                  value={g.target || ''}
                  aria-label="Target"
                  onChange={e => update(i, { target: Number(e.target.value) || 0 })}
                />
                <Dropdown
                  block
                  value={g.metric}
                  options={METRIC_OPTIONS}
                  onChange={v => update(i, { metric: v })}
                  ariaLabel="Measure"
                />
              </div>
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

            <Field label="Every" info="How long one window lasts. Windows of more than one week or month run back to back from a fixed anchor, so they never overlap.">
              <div className="goal-pair">
                <input
                  className="input" type="number" min="1" max={MAX_GOAL_SPAN}
                  value={g.span}
                  aria-label="Number of periods"
                  onChange={e => update(i, { span: Math.min(MAX_GOAL_SPAN, Math.max(1, Number(e.target.value) || 1)) })}
                />
                <Dropdown
                  block
                  value={g.period}
                  options={PERIOD_OPTIONS}
                  onChange={v => update(i, { period: v })}
                  ariaLabel="Period"
                />
              </div>
            </Field>

            <Field label="Min km" info="Activities shorter than this don't count toward the goal at all. 0 means no minimum.">
              <input
                className="input" type="number" min="0" step="0.5" placeholder="0" style={{ width: '100%' }}
                value={g.minKm || ''}
                aria-label="Minimum distance in km"
                onChange={e => update(i, { minKm: Number(e.target.value) || 0 })}
              />
            </Field>

            <Field label="Min min" info="Activities shorter than this many minutes don't count toward the goal at all. 0 means no minimum.">
              <input
                className="input" type="number" min="0" step="5" placeholder="0" style={{ width: '100%' }}
                value={g.minMinutes || ''}
                aria-label="Minimum duration in minutes"
                onChange={e => update(i, { minMinutes: Number(e.target.value) || 0 })}
              />
            </Field>

            <button
              className="btn-icon goal-remove"
              onClick={() => setRemoving(g)}
              title="Remove goal"
              aria-label="Remove goal"
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

      {removing && (
        <ConfirmDialog
          title="Remove this goal?"
          message={<>
            <strong>{describeGoal(removing)}</strong> will be removed, along with the streak the
            dashboard tracks for it. Nothing is deleted until you save.
          </>}
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            setGoals(prev => prev.filter(g => g.id !== removing.id))
            setRemoving(null)
          }}
          onCancel={() => setRemoving(null)}
        />
      )}
    </SettingsCard>

    <SettingsCard
      title="How goals look"
      description="Presentation only — every style shows the same numbers, and switching never changes what a goal means or when you are notified about one. Applies as soon as you pick it."
    >
      <div className="theme-choices">
        {GOAL_STYLES.map(st => {
          const on = (cfg.goalStyle ?? 'classic') === st.id
          return (
            <button
              key={st.id}
              className={`theme-choice${on ? ' active' : ''}`}
              aria-pressed={on}
              onClick={() => setCfg(prev => ({ ...prev, goalStyle: st.id }))}
            >
              <span className="theme-choice-label">{st.label}</span>
              <span className="theme-choice-hint">{st.blurb}</span>
              {on && <Check size={13} className="theme-choice-tick" />}
            </button>
          )
        })}
      </div>

      <label className="switch">
        <input
          type="checkbox"
          checked={cfg.showGoalHistory !== false}
          onChange={e => setCfg(prev => ({ ...prev, showGoalHistory: e.target.checked }))}
        />
        <span className="switch-track" />
        Show recent windows
      </label>
      <span className="field-hint">
        The run of bars under each goal: filled where you met the target, with a + where you beat
        it. Every style can show them.
      </span>

      <label className="switch">
        <input
          type="checkbox"
          checked={cfg.showGoalPeriods === true}
          disabled={cfg.showGoalHistory === false}
          onChange={e => setCfg(prev => ({ ...prev, showGoalPeriods: e.target.checked }))}
        />
        <span className="switch-track" />
        Label those windows
      </label>
      <span className="field-hint">
        Puts the week number or month name under each bar. Off by default — eight labels is a lot
        of small text on a phone, and the Classic and Pace styles are the only ones with room.
      </span>
    </SettingsCard>
    </>
  )
}
