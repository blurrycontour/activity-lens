import { useState } from 'react'
import { Bug, Lightbulb, MessageSquare, Send, ChevronDown } from 'lucide-react'
import { api, ApiError, type FeedbackCategory } from '../../lib/api'
import { collectDiagnostics, debugLogEntries } from '../../lib/debugLog'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import StatusMsg, { type Msg } from '../../components/StatusMsg'
import Dropdown, { type DropdownOption } from '../../components/Dropdown'

const CATEGORIES: DropdownOption<FeedbackCategory>[] = [
  { value: 'bug', label: 'Something is broken', glyph: <Bug size={14} color="var(--text-3)" aria-hidden /> },
  { value: 'idea', label: 'I have a suggestion', glyph: <Lightbulb size={14} color="var(--text-3)" aria-hidden /> },
  { value: 'other', label: 'Something else', glyph: <MessageSquare size={14} color="var(--text-3)" aria-hidden /> },
]

/**
 * Sends a report to whoever runs this instance.
 *
 * The diagnostics toggle is the point of the page. A bug report without the
 * console behind it is a guess, and on a phone there is no way for the person
 * reporting it to get at that console at all — so the app keeps a rolling
 * record and offers to attach it. Opt-in and previewable, because "attach logs"
 * is meaningless as a promise unless you can see what you are attaching.
 */
export default function FeedbackSettings() {
  const [category, setCategory] = useState<FeedbackCategory>('bug')
  const [message, setMessage] = useState('')
  const [attach, setAttach] = useState(true)
  const [showLogs, setShowLogs] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  const logCount = debugLogEntries().length

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim() || busy) return
    setBusy(true)
    setMsg(null)
    try {
      await api.sendFeedback({
        category,
        message: message.trim(),
        // Collected at submit rather than on mount, so it includes anything
        // that went wrong while the report was being written.
        diagnostics: attach ? collectDiagnostics() : undefined,
      })
      setMessage('')
      setMsg({ ok: true, text: 'Thanks — your feedback was sent.' })
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not send feedback.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <SettingsCard
        title="Send feedback"
        icon={<MessageSquare size={16} />}
        description="Goes to whoever administers this instance."
      >
        <Field label="What is this about?">
          <Dropdown value={category} onChange={setCategory} options={CATEGORIES} block ariaLabel="Feedback category" />
        </Field>

        <Field label="Details">
          <textarea
            className="input"
            rows={7}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder={category === 'bug'
              ? 'What did you do, what did you expect, and what happened instead?'
              : 'Tell us what you have in mind.'}
            maxLength={5000}
            required
          />
        </Field>

        <label className="feedback-attach">
          <input type="checkbox" checked={attach} onChange={e => setAttach(e.target.checked)} />
          <span>
            <span className="feedback-attach-label">Attach debug information</span>
            <span className="feedback-attach-sub">
              App version, device and screen size, and the {logCount} warning{logCount === 1 ? '' : 's'} and
              error{logCount === 1 ? '' : 's'} recorded this session. No workout data, and nothing you have not seen.
            </span>
          </span>
        </label>

        {attach && (
          <div className="feedback-preview">
            <button type="button" className="feedback-preview-toggle" onClick={() => setShowLogs(v => !v)}>
              <ChevronDown size={13} style={{ transform: showLogs ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
              {showLogs ? 'Hide' : 'Show'} what will be attached
            </button>
            {showLogs && <pre className="feedback-preview-body">{collectDiagnostics()}</pre>}
          </div>
        )}

        <div className="settings-actions">
          <button className="btn btn-primary" type="submit" disabled={busy || !message.trim()}>
            <Send size={14} /> {busy ? 'Sending…' : 'Send feedback'}
          </button>
          <StatusMsg msg={msg} />
        </div>
      </SettingsCard>
    </form>
  )
}
