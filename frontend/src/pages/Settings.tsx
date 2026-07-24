import { Check } from 'lucide-react'
import { ACCENTS, applyAccent } from '../lib/theme'

interface SettingsProps {
  accent: string
  onAccentChange: (a: string) => void
}

export default function Settings({ accent, onAccentChange }: SettingsProps) {
  function handleAccent(value: string) {
    onAccentChange(value)
    applyAccent(value)
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

        {/* HR zones */}
        <section className="card">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Heart Rate & Performance</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            {[
              { label: 'Max HR', value: '185', unit: 'bpm' },
              { label: 'Resting HR', value: '52', unit: 'bpm' },
              { label: 'Threshold Pace', value: '5:00', unit: '/km' },
              { label: 'FTP (Cycling)', value: '240', unit: 'W' },
            ].map(f => (
              <div key={f.label} style={{ minWidth: 0 }}>
                <label style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginBottom: 4 }}>{f.label}</label>
                <div style={{ display: 'flex' }}>
                  <input
                    className="input"
                    defaultValue={f.value}
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
        </section>
      </div>
    </>
  )
}
