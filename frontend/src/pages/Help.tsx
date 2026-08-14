import { useState } from 'react'
import {
  ChevronDown, Upload, LayoutDashboard, Activity, CalendarCheck,
  Watch, LineChart, Settings as SettingsIcon, Keyboard, HelpCircle, Users,
} from 'lucide-react'

const features = [
  { icon: LayoutDashboard, title: 'Dashboard', text: 'Your at-a-glance view: totals with period-on-period change, goal streaks, this week against your usual week, training load, and gear wear.' },
  { icon: Activity, title: 'Workouts', text: 'Your own library, in list or grid view. Open one for charts, splits, and its route on the map.' },
  { icon: Users, title: 'Discover', text: 'Everyone else on this server: the people, what they have shared with you, and what they have made public. Opening a person shows their profile and the workouts you can see of theirs.' },
  { icon: LineChart, title: 'Analysis', text: 'Everything about how you are performing, split into four tabs: Records, Trends, Efficiency and Load. One time range and sport filter drives them all.' },
  { icon: CalendarCheck, title: 'Consistency', text: 'Everything about whether you are showing up: a calendar heatmap, day-of-week habits, year-over-year comparisons and cumulative distance.' },
  { icon: Watch, title: 'Equipment', text: 'Track gear like shoes, watches and bikes, and see the workouts logged against each.' },
]

const shortcuts = [
  { key: 'G then D', action: 'Go to Dashboard' },
  { key: 'G then W', action: 'Go to Workouts' },
  { key: 'G then P', action: 'Go to Discover (people)' },
  { key: 'G then A', action: 'Go to Analysis' },
  { key: 'G then C', action: 'Go to Consistency' },
  { key: 'G then M', action: 'Go to Map' },
  { key: 'G then E', action: 'Go to Equipment' },
  { key: 'Cmd / Ctrl + I', action: 'Add a workout' },
  { key: '[', action: 'Collapse / expand sidebar' },
  { key: 'Esc', action: 'Close modal or go back' },
]

const faqs = [
  { q: 'How do I share a workout?', a: 'Open the workout and choose Share from the ⋮ menu, or use the share icon on any row in your list. You can make it public — visible to everyone signed in to this instance — and separately share it with specific people. Nothing is ever readable without an account; there are no public links.' },
  { q: 'Where do I see what I have shared?', a: 'Open your own profile — from Discover, where you are pinned first, or from Settings → Profile. It has two tabs: Shared, everything you have sent to specific people, and Public, everything anyone signed in here can see. On the Workouts page your rows also carry a badge: a globe if public, a person icon with a count if shared. Opening the share dialog shows exactly who has access.' },
  { q: "What are the tabs on someone else's profile?", a: 'Three: "Shared with me" is what they have sent you, "Shared by me" is what you have sent them, and "Public" is what they have opened to everyone on this server. Your own profile has the first two collapsed into one Shared tab, since nobody shares a workout with themselves.' },
  { q: 'What can other people see?', a: 'Everything you see on the workout page — the route, map, heart rate, pace, cadence and splits — except your private notes and your equipment. They cannot edit, delete, recalculate or change anything.' },
  { q: 'If I make a workout private again, does that unshare it?', a: 'No. The public toggle and direct shares are independent, so switching back to private removes it from the Public tab on Discover but the people you shared it with keep access. Remove them individually in the share dialog, or use "Remove everyone".' },
  { q: 'How do I add a workout?', a: 'Click "Add Workout" in the sidebar (or press Cmd/Ctrl + I). Upload a .gpx or .tcx file to import a recorded activity — you\'ll see a preview of the numbers before saving — or switch to Manual Entry to type in the details yourself.' },
  { q: 'Which file formats are supported?', a: 'Activity Lens imports .gpx (universal GPS exchange) and .tcx (Training Center XML) files. Most watches and apps can export one of these.' },
  { q: 'How are calories estimated?', a: 'When an imported file doesn\'t include calories, they are estimated for you. Under Settings → Calorie Estimation you can choose a heart-rate based method (which uses your sex, age, and weight from the About You section) or a distance-only method.' },
  { q: 'What do the small icons next to some numbers mean?', a: 'A Σ icon means the value was calculated or derived from the recorded data. A pencil icon means you entered that value manually. Recalculating a workout replaces manual values with derived ones.' },
  { q: 'How do heart-rate metrics work?', a: 'Where a workout records heart rate, its zones are shown directly. For workouts without their own max HR, your Max HR from Settings → Heart Rate & Performance is used instead.' },
  { q: 'How do training goals and streaks work?', a: 'Add as many goals as you like under Settings → Training Goals. A goal can count activities ("two runs of at least 5 km a week"), total distance ("40 km of hiking a month") or total time ("30 hours of running a month"), over a window of one or more weeks or months. Reorder them with the arrows — the dashboard shows them in that order. Each is tracked separately with its own streak of windows that met the target, a progress bar for the window in hand, and a trophy once it is done. In the history row a filled bar is a window you met and a + marks one you beat; Settings → Training goals picks how the card is drawn — Standard, Rings, Ledger or Today’s move, which names the one thing that would keep you on track — and whether those bars carry week or month labels. Every style shows the same numbers, and each goal is marked with its sport\u2019s colour and icon. Meet every goal at once and the dashboard says so, once per app launch. The window in progress extends a streak once you hit it, but never breaks one, so a quiet Monday costs you nothing. Windows longer than a single week or month run back to back from a fixed anchor rather than counting back from today, so they never overlap. Either minimum — distance or duration — filters which activities count at all, rather than trimming the total. Distance minimums are matched against the figure shown on the workout, so a run listed as 5.0 km counts toward a 5 km goal even though its recorded distance is 4,983 m.' },
  { q: 'What is the Training Load tile telling me?', a: 'It compares your average daily effort over the last 7 days against the last 28. Around 1.0 means this week matches what your body is used to, higher means you are building, lower means you are easing off. It only appears once you have six weeks of history and at least a dozen activities with heart rate, because below that a single session swings it wildly. Treat it as a description of your load rather than a medical verdict — the injury-risk thresholds this metric is known for are debated in the research.' },
  { q: 'When does gear tell me to replace it?', a: 'Each piece of equipment has a replacement distance you can set when editing it; shoes default to 600 km. Once total linked distance passes 80% of that, the dashboard surfaces the most worn item. Gear types with no distance-based wear, like watches, are never nudged about.' },
  { q: 'What does the info icon next to a chart title do?', a: 'It opens a longer explanation of what that chart measures and how to read it — including the caveats worth knowing before you act on it. Hover it on desktop, tap it on mobile.' },
  { q: 'Where did the Timeline and Heatmap pages go?', a: 'Timeline was merged into Analysis, which now has Records, Trends, Efficiency and Load tabs sharing one filter. Heatmap became Consistency and gained year-over-year and cumulative-distance charts. Old links to /timeline and /heatmap redirect automatically.' },
  { q: 'How do I know when there is a new version?', a: 'The server tells you. When it starts up on a release it has not announced before, everyone gets one notification, and opening it starts the update — on Android that is the download and the system installer, in a browser it is simply loading the new build. It arrives even if you are signed out on that device, which is the case it exists for: a phone nobody has opened in a while is exactly the one running an old app. Turn it off under Settings → Notifications if you would rather find updates yourself.' },
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
          <h3 className="card-title" style={{ marginBottom: 4 }}>
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
          <h3 className="card-title" style={{ marginBottom: 12 }}>The pages</h3>
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
          <h3 className="card-title" style={{ marginBottom: 4 }}>
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
          <h3 className="card-title" style={{ marginBottom: 12 }}>
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
          <h3 className="card-title" style={{ marginBottom: 12 }}>
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
