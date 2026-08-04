import { useCallback, useEffect, useState } from 'react'
import { Bug, Check, ChevronDown, Lightbulb, MessageSquare, RotateCcw, Trash2 } from 'lucide-react'
import { api, ApiError, type Feedback } from '../../lib/api'
import SettingsCard from '../../components/SettingsCard'
import StatusMsg, { type Msg } from '../../components/StatusMsg'

const CATEGORY_ICON = {
  bug: <Bug size={14} />,
  idea: <Lightbulb size={14} />,
  other: <MessageSquare size={14} />,
} as const

function when(iso: string): string {
  const d = new Date(iso)
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
}

/** Everything users have reported, newest first. */
export default function FeedbackAdmin() {
  const [items, setItems] = useState<Feedback[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<Msg | null>(null)
  // Diagnostics blobs are fetched one at a time, on expand — the listing
  // deliberately does not carry them, and most reports are never opened.
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    try {
      setItems((await api.adminFeedback()).feedback)
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not load feedback.' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function expand(item: Feedback) {
    if (open === item.id) { setOpen(null); return }
    setOpen(item.id)
    if (!item.hasDiagnostics || detail[item.id]) return
    try {
      const { feedback } = await api.adminFeedbackDetail(item.id)
      setDetail(prev => ({ ...prev, [item.id]: feedback.diagnostics ?? '' }))
    } catch {
      setDetail(prev => ({ ...prev, [item.id]: 'Could not load the attached diagnostics.' }))
    }
  }

  async function resolve(item: Feedback) {
    const resolved = !item.resolvedAt
    try {
      await api.adminResolveFeedback(item.id, resolved)
      await load()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not update.' })
    }
  }

  async function remove(item: Feedback) {
    if (!confirm(`Delete this feedback from ${item.username}? This cannot be undone.`)) return
    try {
      await api.adminDeleteFeedback(item.id)
      await load()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not delete.' })
    }
  }

  return (
    <SettingsCard
      title="Feedback"
      icon={<MessageSquare size={16} />}
      description="Reports and suggestions users have sent from Settings."
      actions={<StatusMsg msg={msg} />}
    >
      {loading
        ? <p className="settings-empty">Loading…</p>
        : items.length === 0
          ? <p className="settings-empty">Nothing yet.</p>
          : (
            <div className="feedback-list">
              {items.map(item => (
                <div key={item.id} className={`feedback-item${item.resolvedAt ? ' resolved' : ''}`}>
                  <div className="feedback-item-head">
                    <span className="feedback-item-icon">{CATEGORY_ICON[item.category] ?? CATEGORY_ICON.other}</span>
                    <div className="feedback-item-meta">
                      <span className="feedback-item-who">{item.username}</span>
                      <span className="feedback-item-when">{when(item.createdAt)}</span>
                    </div>
                    <button
                      className="btn-icon"
                      onClick={() => void resolve(item)}
                      title={item.resolvedAt ? 'Mark unresolved' : 'Mark resolved'}
                      aria-label={item.resolvedAt ? 'Mark unresolved' : 'Mark resolved'}
                    >
                      {item.resolvedAt ? <RotateCcw size={15} /> : <Check size={15} />}
                    </button>
                    <button className="btn-icon" onClick={() => void remove(item)} title="Delete" aria-label="Delete" style={{ color: 'var(--danger)' }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <p className="feedback-item-body">{item.message}</p>
                  {item.hasDiagnostics && (
                    <>
                      <button className="feedback-preview-toggle" onClick={() => void expand(item)}>
                        <ChevronDown size={13} style={{ transform: open === item.id ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
                        {open === item.id ? 'Hide' : 'Show'} attached diagnostics
                      </button>
                      {open === item.id && (
                        <pre className="feedback-preview-body">{detail[item.id] ?? 'Loading…'}</pre>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
    </SettingsCard>
  )
}
