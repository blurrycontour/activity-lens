import { useEffect, useState } from 'react'
import { Check, Plus, Trash2 } from 'lucide-react'
import { ACCENTS, applyAccent } from '../lib/theme'
import { WORKOUT_TYPES, TYPE_ICON } from '../data/workouts'
import { describeGoal, newGoal, type Goal } from '../lib/insights'
import { enablePush, disablePush, pushState as pushState_, type PushState } from '../lib/push'
import { api, ApiError, type NotificationKind, type NotifyPrefs } from '../lib/api'
import { useLocalStorage } from '../lib/useLocalStorage'
import { useAuth } from '../context/AuthContext'
import { apiBase, forgetServer, isNative } from '../lib/serverConfig'
import { installedApp, requestUpdateCheck } from '../lib/native/appUpdate'
import ConfirmDialog from '../components/ConfirmDialog'
import NativePushCard from '../components/NativePushCard'
import {
  DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG, STAT_CARDS, WINDOW_OPTIONS,
  DEFAULT_HR_ZONE_CHART, HR_ZONE_CHART_KEY,
  type DashboardConfig, type HRZoneChart, type StatCardId,
} from '../lib/dashboardConfig'

interface SettingsProps {
  accent: string
  onAccentChange: (a: string) => void
}

/** The switches Settings offers, in the order they are listed. */
const NOTIFY_KINDS: { id: NotificationKind; label: string }[] = [
  { id: 'workout_shared', label: 'Someone shares a workout with me' },
  { id: 'gear_worn', label: 'Gear reaches its replacement distance' },
  { id: 'goal_met', label: 'I complete a training goal' },
  { id: 'goal_at_risk', label: "A goal's period is nearly over and I'm short" },
]

/** Everything on, matching the server's default for a user who never saved. */
const DEFAULT_NOTIFY: NotifyPrefs = {
  kinds: Object.fromEntries(NOTIFY_KINDS.map(k => [k.id, true])) as NotifyPrefs['kinds'],
  push: true,
}

export default function Settings({ accent, onAccentChange }: SettingsProps) {
  const { logout } = useAuth()

  /**
   * Points the app at a different server.
   *
   * The session is revoked first, while the address that owns it is still
   * known — afterwards there is nothing left to revoke it against, and it would
   * stay valid until it expired.
   */
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  async function disconnectServer() {
    setDisconnecting(true)
    await logout()
    // Returns to the setup screen by unmounting the providers, which takes all
    // the old server's state with them. No page reload; see forgetServer.
    await forgetServer()
  }

  // The installed app's own version, so the Server card can say what is running
  // and whether checking for an update is worth offering.
  const [appVersion, setAppVersion] = useState<string | null>(null)
  useEffect(() => {
    if (!isNative()) return
    installedApp().then(info => setAppVersion(info.version)).catch(() => {})
  }, [])

  function handleAccent(value: string) {
    onAccentChange(value)
    applyAccent(value)
  }

  const [dashCfg, setDashCfg] = useLocalStorage<DashboardConfig>(DASHBOARD_CFG_KEY, DEFAULT_DASHBOARD_CONFIG)
  function toggleCard(id: StatCardId) {
    setDashCfg(prev => {
      const want = new Set(prev.cards)
      if (want.has(id)) want.delete(id)
      else want.add(id)
      // Keep the master order so cards render consistently.
      return { ...prev, cards: STAT_CARDS.map(c => c.id).filter(c => want.has(c)) }
    })
  }

  const [hrZoneChart, setHrZoneChart] = useLocalStorage<HRZoneChart>(HR_ZONE_CHART_KEY, DEFAULT_HR_ZONE_CHART)

  const [calorieMethod, setCalorieMethod] = useState<'heart-rate' | 'distance'>('heart-rate')
  const [bodyWeightKg, setBodyWeightKg] = useState('70')
  const [sex, setSex] = useState<'male' | 'female' | ''>('')
  const [birthYear, setBirthYear] = useState('')
  const [heightCm, setHeightCm] = useState('')
  const [stepLengthCm, setStepLengthCm] = useState('')
  const [bioBusy, setBioBusy] = useState(false)
  const [bioMsg, setBioMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [calBusy, setCalBusy] = useState(false)
  const [calMsg, setCalMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [notify, setNotify] = useState<NotifyPrefs>(DEFAULT_NOTIFY)
  const [notifyMsg, setNotifyMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [pushKey, setPushKey] = useState('')
  const [pushState, setPushState] = useState<PushState>('off')
  const [pushBusy, setPushBusy] = useState(false)

  const [goals, setGoals] = useState<Goal[]>([])
  const [goalBusy, setGoalBusy] = useState(false)
  const [goalMsg, setGoalMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [maxHr, setMaxHr] = useState('')
  const [restingHr, setRestingHr] = useState('')
  const [thresholdPace, setThresholdPace] = useState('')
  const [ftp, setFtp] = useState('')
  const [perfBusy, setPerfBusy] = useState(false)
  const [perfMsg, setPerfMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    let active = true
    api.getPreferences()
      .then(p => {
        if (!active) return
        setCalorieMethod(p.calorieMethod)
        setBodyWeightKg(String(p.bodyWeightKg))
        setSex(p.sex ?? '')
        setBirthYear(p.birthYear ? String(p.birthYear) : '')
        setHeightCm(p.heightCm ? String(p.heightCm) : '')
        setStepLengthCm(p.stepLengthCm ? String(p.stepLengthCm) : '')
        setMaxHr(p.maxHr ? String(p.maxHr) : '')
        setRestingHr(p.restingHr ? String(p.restingHr) : '')
        setThresholdPace(p.thresholdPace)
        setFtp(p.ftp ? String(p.ftp) : '')
        setNotify(p.notify ?? DEFAULT_NOTIFY)
        setGoals((p.goals ?? []).map(g => ({
          id: g.id || Math.random().toString(36).slice(2, 10),
          count: g.count,
          period: g.period === 'month' ? 'month' : 'week',
          type: g.type as Goal['type'],
          minKm: g.minKm,
        })))
      })
      .catch(() => { /* fall back to defaults */ })
    return () => { active = false }
  }, [])

  // The VAPID key comes from the notifications endpoint rather than its own
  // route, since the panel already fetches it on every load.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [res, state] = await Promise.all([api.notifications(), pushState_()])
        if (!active) return
        setPushKey(res.pushKey ?? '')
        setPushState(res.pushKey ? state : 'unsupported')
      } catch { /* leave push showing as unavailable */ }
    })()
    return () => { active = false }
  }, [])

  function buildPayload() {
    return {
      calorieMethod,
      bodyWeightKg: Number(bodyWeightKg) || 70,
      sex,
      birthYear: Number(birthYear) || 0,
      heightCm: Number(heightCm) || 0,
      stepLengthCm: Number(stepLengthCm) || 0,
      maxHr: Number(maxHr) || 0,
      restingHr: Number(restingHr) || 0,
      thresholdPace,
      ftp: Number(ftp) || 0,
      goals,
      notify,
    }
  }

  /** Persists the notification switches on their own. */
  async function saveNotify(next: NotifyPrefs) {
    setNotify(next)
    setNotifyMsg(null)
    try {
      await api.savePreferences({ ...buildPayload(), notify: next })
    } catch (e) {
      setNotifyMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    }
  }

  /** Enrols or removes this browser from push, reporting why if it refuses. */
  async function togglePush(on: boolean) {
    setPushBusy(true)
    setNotifyMsg(null)
    try {
      const state = on ? await enablePush(pushKey) : await disablePush()
      setPushState(state)
      if (state === 'denied') {
        setNotifyMsg({ ok: false, text: 'Your browser is blocking notifications. Allow them for this site in its settings, then try again.' })
      }
    } catch (e) {
      setNotifyMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not change push notifications' })
    } finally {
      setPushBusy(false)
    }
  }

  function updateGoal(index: number, patch: Partial<Goal>) {
    setGoals(prev => prev.map((g, i) => i === index ? { ...g, ...patch } : g))
  }

  async function saveGoals() {
    setGoalBusy(true); setGoalMsg(null)
    try {
      // Drop half-filled rows rather than rejecting the whole save.
      const kept = goals.filter(g => g.count > 0)
      setGoals(kept)
      const updated = await api.savePreferences({ ...buildPayload(), goals: kept })
      setGoals((updated.goals ?? []) as Goal[])
      setGoalMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setGoalMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setGoalBusy(false) }
  }

  async function saveBio() {
    setBioBusy(true); setBioMsg(null)
    try {
      const updated = await api.savePreferences(buildPayload())
      setBodyWeightKg(String(updated.bodyWeightKg))
      setSex(updated.sex ?? '')
      setBirthYear(updated.birthYear ? String(updated.birthYear) : '')
      setHeightCm(updated.heightCm ? String(updated.heightCm) : '')
      setStepLengthCm(updated.stepLengthCm ? String(updated.stepLengthCm) : '')
      setBioMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setBioMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setBioBusy(false) }
  }

  async function saveCalories() {
    setCalBusy(true); setCalMsg(null)
    try {
      const updated = await api.savePreferences(buildPayload())
      setBodyWeightKg(String(updated.bodyWeightKg))
      setCalMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setCalMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setCalBusy(false) }
  }

  async function savePerformance() {
    setPerfBusy(true); setPerfMsg(null)
    try {
      await api.savePreferences(buildPayload())
      setPerfMsg({ ok: true, text: 'Saved' })
    } catch (e) {
      setPerfMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Save failed' })
    } finally { setPerfBusy(false) }
  }

  return (
    <>
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Settings</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Appearance & preferences</p>
      </div>

      <div className="page-content" style={{ maxWidth: 720, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Accent color */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Accent Color</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Used for active states, highlights, and interactive elements.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
            {ACCENTS.map(a => (
              <button
                key={a.value}
                onClick={() => handleAccent(a.value)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: `1.5px solid ${accent === a.value ? a.value : 'var(--border)'}`,
                  background: accent === a.value ? a.dim : 'var(--bg-3)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{
                  width: 18, height: 18, borderRadius: '50%',
                  background: a.value, flexShrink: 0,
                  boxShadow: accent === a.value ? `0 0 8px ${a.glow}` : 'none',
                }} />
                <span style={{ fontSize: 12, fontWeight: 500, color: accent === a.value ? a.value : 'var(--text-2)', flex: 1, textAlign: 'left' }}>
                  {a.name}
                </span>
                {accent === a.value && <Check size={13} color={a.value} />}
              </button>
            ))}
          </div>
        </section>

        {/* Dashboard */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Dashboard</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Choose which summary cards appear on your dashboard and the time window their
            totals (and the activity mix) are calculated over.
          </p>
          <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Stat cards</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
            {STAT_CARDS.map(c => {
              const on = dashCfg.cards.includes(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() => toggleCard(c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8,
                    border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                    background: on ? 'var(--primary-dim)' : 'var(--bg-3)',
                    color: on ? 'var(--primary)' : 'var(--text-2)',
                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  {on && <Check size={13} />}
                  {c.label}
                </button>
              )
            })}
          </div>
          <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 6 }}>Time window</label>
          <select
            className="input"
            style={{ width: '100%', maxWidth: 220 }}
            value={dashCfg.windowDays}
            onChange={e => setDashCfg(prev => ({ ...prev, windowDays: Number(e.target.value) }))}
          >
            {WINDOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
            <label className="switch">
              <input
                type="checkbox"
                checked={dashCfg.showDeltas !== false}
                onChange={e => setDashCfg(prev => ({ ...prev, showDeltas: e.target.checked }))}
              />
              <span className="switch-track" />
              Show change against the previous period
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={dashCfg.showSparklines !== false}
                onChange={e => setDashCfg(prev => ({ ...prev, showSparklines: e.target.checked }))}
              />
              <span className="switch-track" />
              Show trend sparklines on stat cards
            </label>
          </div>
          <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
            Change is measured against the equally long period immediately before your time
            window, so it is unavailable when the window is set to All time.
          </p>
        </section>

        {/* Notifications */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Notifications</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            What Activity Lens tells you about, and whether it may reach you when the app is closed.
          </p>

          {/* The master switch leads: whether notifications can reach you at all
              matters more than which ones, and the per-kind list below is
              meaningless to someone who has not granted permission. */}
          {isNative() ? (
            /* The app enrols through a UnifiedPush distributor instead of the
               browser's push service, which does not exist in the WebView. Its
               own component: none of the state below — VAPID key, permission,
               subscription — applies to it. */
            <>
              <NativePushCard
                pushPref={notify.push}
                onPushPrefChange={on => saveNotify({ ...notify, push: on })}
              />
              {/* saveNotify reports its own failures here rather than throwing,
                  so a preference that did not save still says so on native. */}
              {notifyMsg && !notifyMsg.ok && (
                <p style={{ fontSize: 12, marginTop: 10, color: '#ef4444' }}>{notifyMsg.text}</p>
              )}
            </>
          ) : (
          <div style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            {pushState === 'unsupported' ? (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Push Notifications</div>
                <p style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.5 }}>
                  Unavailable in this browser. On iPhone or iPad, add Activity Lens to your Home
                  Screen first — Safari only allows push for installed apps.
                </p>
              </>
            ) : (
              <>
                <label className="switch" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  <input
                    type="checkbox"
                    checked={pushState === 'on' && notify.push}
                    disabled={pushBusy || pushState === 'denied'}
                    onChange={async e => {
                      const on = e.target.checked
                      await saveNotify({ ...notify, push: on })
                      await togglePush(on)
                    }}
                  />
                  <span className="switch-track" />
                  Push Notifications
                </label>
                <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 8, lineHeight: 1.5 }}>
                  Reaches you even when Activity Lens is closed. This is per browser and per device,
                  so turn it on anywhere you want to be notified.
                </p>
              </>
            )}
            {notifyMsg && (
              <p style={{ fontSize: 12, marginTop: 10, color: notifyMsg.ok ? 'var(--primary)' : '#ef4444' }}>{notifyMsg.text}</p>
            )}
          </div>
          )}

          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-3)', marginBottom: 12 }}>
              Notify me when
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {NOTIFY_KINDS.map(k => (
                <label className="switch" key={k.id} style={{ fontSize: 13, color: 'var(--text-2)' }}>
                  <input
                    type="checkbox"
                    checked={notify.kinds[k.id] !== false}
                    onChange={e => void saveNotify({ ...notify, kinds: { ...notify.kinds, [k.id]: e.target.checked } })}
                  />
                  <span className="switch-track" />
                  {k.label}
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Training goals */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Training Goals</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            What a good week or month looks like for you — say two runs of at least 5 km a week,
            plus two hikes a month. The dashboard tracks each one's streak separately. Distances are
            matched against the figure shown on the workout, so a run listed as 5.0 km counts toward
            a 5 km goal.
          </p>

          {goals.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 12 }}>
              No goals yet. Add one to start tracking a streak.
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 12 }}>
            {goals.map((g, i) => (
              <div key={g.id} className="goal-row">
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>How many</label>
                  <input
                    className="input" type="number" min="1" max="93" style={{ width: '100%' }}
                    value={g.count || ''}
                    onChange={e => updateGoal(i, { count: Number(e.target.value) || 0 })}
                  />
                </div>
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Sport</label>
                  <select className="input" style={{ width: '100%' }} value={g.type} onChange={e => updateGoal(i, { type: e.target.value as Goal['type'] })}>
                    <option value="">Any activity</option>
                    {WORKOUT_TYPES.map(t => <option key={t} value={t}>{TYPE_ICON[t]} {t}</option>)}
                  </select>
                </div>
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Per</label>
                  <select className="input" style={{ width: '100%' }} value={g.period} onChange={e => updateGoal(i, { period: e.target.value as Goal['period'] })}>
                    <option value="week">Week</option>
                    <option value="month">Month</option>
                  </select>
                </div>
                <div style={{ minWidth: 0 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Min km</label>
                  <input
                    className="input" type="number" min="0" step="0.5" placeholder="any" style={{ width: '100%' }}
                    value={g.minKm || ''}
                    onChange={e => updateGoal(i, { minKm: Number(e.target.value) || 0 })}
                  />
                </div>
                <button
                  className="btn-icon"
                  onClick={() => setGoals(prev => prev.filter((_, j) => j !== i))}
                  title="Remove goal"
                  style={{ alignSelf: 'end', marginBottom: 1, color: '#ef4444' }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={() => setGoals(prev => [...prev, newGoal()])} disabled={goals.length >= 12}>
              <Plus size={14} /> Add goal
            </button>
            <button className="btn btn-primary" onClick={saveGoals} disabled={goalBusy} style={{ opacity: goalBusy ? 0.5 : 1 }}>Save</button>
            {goalMsg && <span style={{ fontSize: 12, color: goalMsg.ok ? 'var(--primary)' : 'var(--red, #dc2626)' }}>{goalMsg.text}</span>}
          </div>
          {goals.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 12, lineHeight: 1.6 }}>
              {goals.filter(g => g.count > 0).map(describeGoal).join(' · ')}
            </p>
          )}
        </section>

        {/* Charts */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Charts</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            How the heart-rate zone breakdown is drawn on a workout. The histogram makes it easier to
            compare zones; the donut emphasises their share of the whole.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {([
              { id: 'histogram', label: 'Histogram' },
              { id: 'pie', label: 'Donut' },
            ] as const).map(o => {
              const on = hrZoneChart === o.id
              return (
                <button
                  key={o.id}
                  onClick={() => setHrZoneChart(o.id)}
                  style={{
                    flex: '1 1 160px', padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${on ? 'var(--primary)' : 'var(--border)'}`,
                    background: on ? 'var(--primary-dim)' : 'var(--bg-3)',
                    color: on ? 'var(--primary)' : 'var(--text-2)',
                    fontSize: 12, fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </section>

        {/* Units */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Units</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['Metric (km, m)', 'Imperial (mi, ft)'].map(u => (
              <button
                key={u}
                style={{
                  flex: '1 1 160px', padding: '8px 12px',
                  borderRadius: 8, border: `1px solid ${u.includes('Metric') ? 'var(--primary)' : 'var(--border)'}`,
                  background: u.includes('Metric') ? 'var(--primary-dim)' : 'var(--bg-3)',
                  color: u.includes('Metric') ? 'var(--primary)' : 'var(--text-2)',
                  fontSize: 12, fontWeight: 500, cursor: 'pointer',
                }}
              >
                {u}
              </button>
            ))}
          </div>
        </section>

        {/* Physiology / About You */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>About You</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Body metrics used to personalize calorie and effort estimates. Kept private to your account.
            Step length is used to estimate step counts from distance for runs and hikes.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Sex</label>
              <select className="input" style={{ width: '100%' }} value={sex} onChange={e => setSex(e.target.value as typeof sex)}>
                <option value="">Prefer not to say</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Birth year</label>
              <input className="input" type="number" min="1900" max={new Date().getFullYear()} placeholder="1990" style={{ width: '100%' }} value={birthYear} onChange={e => setBirthYear(e.target.value)} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Height (cm)</label>
              <input className="input" type="number" min="100" max="250" placeholder="175" style={{ width: '100%' }} value={heightCm} onChange={e => setHeightCm(e.target.value)} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Step length (cm)</label>
              <input className="input" type="number" min="30" max="200" placeholder="75" style={{ width: '100%' }} value={stepLengthCm} onChange={e => setStepLengthCm(e.target.value)} />
            </div>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Body weight (kg)</label>
              <input className="input" type="number" min="25" max="300" placeholder="70" style={{ width: '100%' }} value={bodyWeightKg} onChange={e => setBodyWeightKg(e.target.value)} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={saveBio} disabled={bioBusy} style={{ opacity: bioBusy ? 0.5 : 1 }}>Save</button>
            {bioMsg && <span style={{ fontSize: 12, color: bioMsg.ok ? 'var(--primary)' : 'var(--red, #dc2626)' }}>{bioMsg.text}</span>}
          </div>
        </section>

        {/* Calorie estimation */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Calorie Estimation</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Used to estimate calories burned when an imported workout doesn't already include them.
            The heart-rate method uses your sex, age, and weight from About You.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>Method</label>
              <select className="input" style={{ width: '100%' }} value={calorieMethod} onChange={e => setCalorieMethod(e.target.value as typeof calorieMethod)}>
                <option value="heart-rate">Heart rate, then distance</option>
                <option value="distance">Distance only</option>
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={saveCalories} disabled={calBusy} style={{ opacity: calBusy ? 0.5 : 1 }}>Save</button>
            {calMsg && <span style={{ fontSize: 12, color: calMsg.ok ? 'var(--primary)' : 'var(--red, #dc2626)' }}>{calMsg.text}</span>}
          </div>
        </section>

        {/* HR zones */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Heart Rate & Performance</h3>
          <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
            Max HR is used to compute heart-rate zones for workouts that don't report their own.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {([
              { label: 'Max HR', value: maxHr, set: setMaxHr, unit: 'bpm', type: 'number', placeholder: '185' },
              { label: 'Resting HR', value: restingHr, set: setRestingHr, unit: 'bpm', type: 'number', placeholder: '52' },
              { label: 'Threshold Pace', value: thresholdPace, set: setThresholdPace, unit: '/km', type: 'text', placeholder: '5:00' },
              { label: 'FTP (Cycling)', value: ftp, set: setFtp, unit: 'W', type: 'number', placeholder: '240' },
            ] as const).map(f => (
              <div key={f.label} style={{ minWidth: 0 }}>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                <div style={{ display: 'flex' }}>
                  <input
                    className="input"
                    type={f.type}
                    value={f.value}
                    placeholder={f.placeholder}
                    onChange={e => f.set(e.target.value)}
                    style={{ borderRadius: '6px 0 0 6px', flex: 1, minWidth: 0 }}
                  />
                  <span style={{
                    background: 'var(--bg-3)', border: '1px solid var(--border)', borderLeft: 'none',
                    borderRadius: '0 6px 6px 0', padding: '7px 8px', fontSize: 12, color: 'var(--text-3)',
                    fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', flexShrink: 0,
                  }}>{f.unit}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
            <button className="btn btn-primary" onClick={savePerformance} disabled={perfBusy} style={{ opacity: perfBusy ? 0.5 : 1 }}>Save</button>
            {perfMsg && <span style={{ fontSize: 12, color: perfMsg.ok ? 'var(--primary)' : 'var(--red, #dc2626)' }}>{perfMsg.text}</span>}
          </div>
        </section>

        {/* Which server this app talks to. Native only: in a browser the answer
            is "the one that served this page" and cannot be changed. */}
        {isNative() && (
          <section className="card">
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Server</h3>
            <p style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 16 }}>
              This app is connected to the server below. Disconnecting signs you out on this
              device and returns to the setup screen; nothing on the server is changed.
            </p>
            <div style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-2)',
              background: 'var(--bg-3)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '8px 10px', overflowWrap: 'anywhere',
            }}>{apiBase()}</div>
            {appVersion && (
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 12, marginTop: 12, fontSize: 12, color: 'var(--text-3)',
              }}>
                <span>App version <span style={{ fontFamily: 'var(--font-mono)' }}>{appVersion}</span></span>
              </div>
            )}
            {confirmDisconnect && (
              <ConfirmDialog
                title="Disconnect from this server?"
                message="You will be signed out on this device and returned to the setup screen. Nothing on the server is changed."
                confirmLabel="Disconnect"
                busyLabel="Disconnecting…"
                busy={disconnecting}
                danger
                onConfirm={() => void disconnectServer()}
                onCancel={() => setConfirmDisconnect(false)}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              {/* The app checks on its own at launch and on resume; this is for
                  someone who has just upgraded their server and wants the new
                  app now rather than at the next check. */}
              <button className="btn" onClick={requestUpdateCheck}>Check for updates</button>
              <button className="btn" onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
            </div>
          </section>
        )}
      </div>
    </>
  )
}
