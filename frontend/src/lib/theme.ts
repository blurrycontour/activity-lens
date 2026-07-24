// Accent color palette and applier shared across the app.

export const ACCENTS: { name: string; value: string; dim: string; glow: string }[] = [
  { name: 'Electric Green', value: '#00e87a', dim: 'rgba(0,232,122,0.15)', glow: 'rgba(0,232,122,0.3)' },
  { name: 'Electric Blue',  value: '#3b82f6', dim: 'rgba(59,130,246,0.15)', glow: 'rgba(59,130,246,0.3)' },
  { name: 'Vivid Orange',   value: '#ff6b35', dim: 'rgba(255,107,53,0.15)', glow: 'rgba(255,107,53,0.3)' },
  { name: 'Violet',         value: '#a855f7', dim: 'rgba(168,85,247,0.15)', glow: 'rgba(168,85,247,0.3)' },
  { name: 'Cyan',           value: '#06b6d4', dim: 'rgba(6,182,212,0.15)',  glow: 'rgba(6,182,212,0.3)'  },
  { name: 'Rose',           value: '#f43f5e', dim: 'rgba(244,63,94,0.15)',  glow: 'rgba(244,63,94,0.3)'  },
]

export function applyAccent(value: string) {
  const a = ACCENTS.find(a => a.value === value) || ACCENTS[0]
  const root = document.documentElement
  root.style.setProperty('--primary', a.value)
  root.style.setProperty('--primary-dim', a.dim)
  root.style.setProperty('--primary-glow', a.glow)
}
