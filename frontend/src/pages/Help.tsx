import { useState } from 'react'
import {
  ChevronDown, Upload, LayoutDashboard, Activity, CalendarCheck,
  Watch, LineChart, Settings as SettingsIcon, Keyboard, HelpCircle,
} from 'lucide-react'

const features = [
  { icon: LayoutDashboard, title: 'Dashboard', text: 'An at-a-glance summary of your recent activity, totals, and trends.' },
  { icon: Activity, title: 'Workouts', text: 'Browse every workout in list or grid view. Open one to see charts, splits, and its route on the map.' },
  { icon: LineChart, title: 'Analysis', text: 'Everything about how you are performing, split into four tabs: Records, Trends, Efficiency and Load. One time range and sport filter drives them all.' },
  { icon: CalendarCheck, title: 'Consistency', text: 'Everything about whether you are showing up: a calendar heatmap, day-of-week habits, year-over-year comparisons and cumulative distance.' },
  { icon: Watch, title: 'Equipment', text: 'Track gear like shoes, watches and bikes, and see the workouts logged against each.' },
]

const shortcuts = [
  { key: 'G then D', action: 'Go to Dashboard' },
  { key: 'G then W', action: 'Go to Workouts' },
  { key: 'G then A', action: 'Go to Analysis' },
  { key: 'G then C', action: 'Go to Consistency' },
  { key: 'G then E', action: 'Go to Equipment' },
  { key: 'Cmd / Ctrl + I', action: 'Add a workout' },
  { key: '[', action: 'Collapse / expand sidebar' },
  { key: 'Esc', action: 'Close modal or go back' },
]

const faqs = [
  { q: 'How do I add a workout?', a: 'Click "Add Workout" in the sidebar (or press Cmd/Ctrl + I). Upload a .gpx or .tcx file to import a recorded activity — you\'ll see a preview of the numbers before saving — or switch to Manual Entry to type in the details yourself.' },
  { q: 'Which file formats are supported?', a: 'Activity Lens imports .gpx (universal GPS exchange) and .tcx (Training Center XML) files. Most watches and apps can export one of these.' },
  { q: 'How are calories estimated?', a: 'When an imported file doesn\'t include calories, they are estimated for you. Under Settings → Calorie Estimation you can choose a heart-rate based method (which uses your sex, age, and weight from the About You section) or a distance-only method.' },
  { q: 'What do the small icons next to some numbers mean?', a: 'A Σ icon means the value was calculated or derived from the recorded data. A pencil icon means you entered that value manually. Recalculating a workout replaces manual values with derived ones.' },
  { q: 'How do heart-rate metrics work?', a: 'Where a workout records heart rate, its zones are shown directly. For workouts without their own max HR, your Max HR from Settings → Heart Rate & Performance is used instead.' },
  { q: 'What does the info icon next to a chart title do?', a: 'It opens a longer explanation of what that chart measures and how to read it — including the caveats worth knowing before you act on it. Hover it on desktop, tap it on mobile.' },
  { q: 'Where did the Timeline and Heatmap pages go?', a: 'Timeline was merged into Analysis, which now has Records, Trends, Efficiency and Load tabs sharing one filter. Heatmap became Consistency and gained year-over-year and cumulative-distance charts. Old links to /timeline and /heatmap redirect automatically.' },
  { q: 'Can I install Activity Lens as an app?', a: 'Yes. It\'s a Progressive Web App, so you can add it to your home screen or desktop from your browser for a full-screen, app-like experience.' },
]

const cardStyle: React.CSSProperties = {
  background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 12, padding: 16,
}

export default function Help() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <>
      <div className="page-header">
        <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Help</h1>
        <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>How Activity Lens works</p>
      </div>

      <div className="page-content" style={{ maxWidth: 820, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Getting started */}
        <section style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Upload size={16} /> Getting started
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 8 }}>
            Add your first workout with the <strong>Add Workout</strong> button in the sidebar. Import a
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}> .gpx</code> or
            <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}> .tcx</code> file exported from
            your watch or app, or enter a workout manually. Once added, it appears across the Dashboard,
            Workouts, Analysis, and Consistency pages.
          </p>
        </section>

        {/* Pages / features */}
        <section>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>The pages</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            {features.map(f => (
              <div key={f.title} style={cardStyle}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <f.icon size={16} color="var(--primary)" />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{f.title}</span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Personalize */}
        <section style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <SettingsIcon size={16} /> Personalize your estimates
          </h3>
          <p style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6, marginTop: 8 }}>
            Visit <strong>Settings</strong> to fill in the <strong>About You</strong> section (sex, birth year,
            height, and weight). These personalize calorie and effort estimates. You can also pick a calorie
            method, set your heart-rate values, and choose an accent color.
          </p>
        </section>

        {/* Keyboard shortcuts */}
        <section style={cardStyle}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Keyboard size={16} /> Keyboard shortcuts
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 8 }}>
            {shortcuts.map(s => (
              <div key={s.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 0' }}>
                <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{s.action}</span>
                <kbd style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-3)',
                  background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 6,
                  padding: '3px 7px', whiteSpace: 'nowrap',
                }}>{s.key}</kbd>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <HelpCircle size={16} /> Frequently asked
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {faqs.map((f, i) => (
              <div key={i} style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
                <button
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12, padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
                    textAlign: 'left', color: 'var(--text)', fontSize: 13, fontWeight: 500,
                  }}
                >
                  {f.q}
                  <ChevronDown
                    size={16}
                    style={{ flexShrink: 0, transition: 'transform 0.15s', transform: openFaq === i ? 'rotate(180deg)' : 'none', color: 'var(--text-3)' }}
                  />
                </button>
                {openFaq === i && (
                  <p style={{ fontSize: 12.5, color: 'var(--text-3)', lineHeight: 1.6, padding: '0 16px 16px' }}>{f.a}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
