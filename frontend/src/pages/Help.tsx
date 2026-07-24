import { useState } from 'react'
import { ChevronDown, HelpCircle, MessageSquare, FileText, Zap } from 'lucide-react'

const faqs = [
  { q: 'How do I import a workout from Garmin or Strava?', a: 'Click "Import Workout" in the sidebar or top bar. You can drag and drop .fit, .gpx, .tcx, or .kml files directly, or connect your Garmin/Strava/Wahoo account for automatic sync.' },
  { q: 'What file formats are supported?', a: 'Activity Lens supports .fit (Garmin, Wahoo), .gpx (universal GPS exchange), .tcx (Training Center XML), and .kml (Google Earth). Compressed .zip archives containing any of these formats also work.' },
  { q: 'How is Training Stress Score (TSS) calculated?', a: 'TSS is estimated from duration and average heart rate relative to your threshold HR. For runs, we use pace-based normalized power equivalents. Set your HR zones in Settings for more accurate calculations.' },
  { q: 'Can I share workouts with others?', a: 'Public sharing via link is available on Pro plans. Go to a workout, tap the share icon, and choose "Public Link" or invite specific users by email.' },
  { q: 'How is the heatmap generated?', a: 'The heatmap shows activity density over the past 365 days. Each cell represents one day; color intensity reflects the number and duration of activities. Filter by sport type using the buttons above the grid.' },
  { q: 'What heart rate zones does Activity Lens use?', a: 'By default we use 5-zone Karvonen model based on age-predicted max HR. You can override max HR and resting HR in Settings → Heart Rate Zones for personalized zones.' },
  { q: 'Is there an offline mode?', a: 'Activity Lens is a PWA. Install it to your home screen and it will cache your recent workouts and graphs for offline viewing. Importing new workouts requires an internet connection.' },
]

const shortcuts = [
  { key: 'G then D', action: 'Go to Dashboard' },
  { key: 'G then W', action: 'Go to Workouts' },
  { key: 'G then H', action: 'Go to Heatmap' },
  { key: 'G then T', action: 'Go to Timeline' },
  { key: 'G then A', action: 'Go to Analysis' },
  { key: 'Cmd/Ctrl + I', action: 'Import Workout' },
  { key: '[', action: 'Collapse Sidebar' },
  { key: 'Escape', action: 'Close modal / go back' },
]

export default function Help() {
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div>
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em' }}>Help & Documentation</h1>
        </div>
      </div>

      <div className="page-content">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20, alignItems: 'start' }}>
          <div>
            {/* FAQ */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
              <HelpCircle size={16} color="var(--primary)" />
              <h2 style={{ fontSize: 15, fontWeight: 600 }}>Frequently Asked Questions</h2>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {faqs.map((faq, i) => (
                <div
                  key={i}
                  className="card"
                  style={{ padding: '14px', cursor: 'pointer', transition: 'border-color 0.15s', borderColor: openFaq === i ? 'var(--border-strong)' : 'var(--border)' }}
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    <span style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.4 }}>{faq.q}</span>
                    <ChevronDown
                      size={16}
                      style={{ flexShrink: 0, transform: openFaq === i ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: 'var(--text-3)' }}
                    />
                  </div>
                  {openFaq === i && (
                    <p style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 10, lineHeight: 1.6 }}>{faq.a}</p>
                  )}
                </div>
              ))}
            </div>

            {/* Keyboard shortcuts */}
            <div style={{ marginTop: 28 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Zap size={16} color="var(--accent)" />
                <h2 style={{ fontSize: 15, fontWeight: 600 }}>Keyboard Shortcuts</h2>
              </div>
              <div className="card">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {shortcuts.map(s => (
                    <div key={s.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-2)' }}>{s.action}</span>
                      <kbd style={{
                        background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 5,
                        padding: '2px 7px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-2)',
                        whiteSpace: 'nowrap',
                      }}>{s.key}</kbd>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="card" style={{ borderColor: 'var(--primary-glow)', borderWidth: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <MessageSquare size={15} color="var(--primary)" />
                <h3 style={{ fontSize: 13, fontWeight: 600 }}>Contact Support</h3>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6, marginBottom: 12 }}>
                Can't find an answer? Our support team responds within 24 hours on weekdays.
              </p>
              <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                Open Support Chat
              </button>
            </div>

            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <FileText size={15} color="var(--blue)" />
                <h3 style={{ fontSize: 13, fontWeight: 600 }}>Documentation</h3>
              </div>
              {['Getting Started Guide', 'Connecting Devices', 'Training Plans', 'API Reference', 'Data Privacy Policy'].map(item => (
                <div
                  key={item}
                  style={{
                    padding: '8px 0', borderBottom: '1px solid var(--border)',
                    fontSize: 13, color: 'var(--blue)', cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  {item}
                  <ChevronDown size={13} style={{ transform: 'rotate(-90deg)' }} />
                </div>
              ))}
            </div>

            <div className="card" style={{ background: 'var(--bg-3)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>VERSION</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>Activity Lens v1.0.0</div>
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>Build 2026.07.23 · PWA enabled</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
