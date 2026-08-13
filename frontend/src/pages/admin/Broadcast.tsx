import { useState } from 'react'
import { Megaphone, Send } from 'lucide-react'
import { api, ApiError } from '../../lib/api'
import SettingsCard from '../../components/SettingsCard'
import Field from '../../components/Field'
import ConfirmDialog from '../../components/ConfirmDialog'
import StatusMsg, { type Msg } from '../../components/StatusMsg'

const MAX_TITLE = 120
const MAX_BODY = 1000

/**
 * Sends one message to everyone on the instance.
 *
 * It arrives as an ordinary notification — the bell, the unread count, and a
 * push if they have it on — so there is nothing new for a recipient to learn.
 * It is also a notification kind like any other, which means someone can switch
 * it off; the copy says so rather than letting an admin assume they have a
 * channel nobody can close.
 */
export default function BroadcastAdmin({ recipients }: { recipients: number }) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [msg, setMsg] = useState<Msg | null>(null)

  const ready = title.trim().length > 0 && title.length <= MAX_TITLE && body.length <= MAX_BODY

  async function send() {
    setSending(true)
    setMsg(null)
    try {
      const { sent } = await api.broadcast({ title: title.trim(), body: body.trim(), includeInactive })
      setTitle('')
      setBody('')
      setMsg({ ok: true, text: `Sent to ${sent} ${sent === 1 ? 'person' : 'people'}` })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not send' })
    } finally {
      setSending(false)
      setConfirming(false)
    }
  }

  return (
    <SettingsCard title="Broadcast a message" icon={<Megaphone size={15} />}>
      <p className="field-hint" style={{ marginBottom: 12 }}>
        Reaches everyone but you, as a notification. Anyone who has switched
        administrator messages off in their own settings will not see it.
      </p>
      <div className="field-grid">
        <Field label="Title">
          <input
            className="input"
            value={title}
            maxLength={MAX_TITLE}
            onChange={e => setTitle(e.target.value)}
            placeholder="Server maintenance on Sunday"
          />
        </Field>
      </div>
      <Field label="Message (optional)">
        <textarea
          className="notes-input"
          value={body}
          maxLength={MAX_BODY}
          rows={3}
          onChange={e => setBody(e.target.value)}
          placeholder="Anything worth a sentence or two. Long enough to explain, short enough to read in a list."
        />
      </Field>

      <label className="switch" style={{ marginTop: 10 }}>
        <input type="checkbox" checked={includeInactive} onChange={e => setIncludeInactive(e.target.checked)} />
        <span className="switch-track" />
        Include deactivated accounts
      </label>

      <div className="settings-actions">
        <button className="btn btn-primary" onClick={() => setConfirming(true)} disabled={!ready || sending}>
          <Send size={14} /> {sending ? 'Sending…' : 'Send'}
        </button>
        <StatusMsg msg={msg} />
      </div>

      {/* A broadcast cannot be recalled — it lands in everyone's bell and on
          the phones of anyone with push. Worth one deliberate step. */}
      {confirming && (
        <ConfirmDialog
          title={`Send to ${recipients} ${recipients === 1 ? 'person' : 'people'}?`}
          message={<>
            “{title.trim()}” goes out as a notification and, for anyone who has push enabled,
            to their phone. It cannot be recalled.
          </>}
          confirmLabel="Send"
          busy={sending}
          busyLabel="Sending…"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void send()}
        />
      )}
    </SettingsCard>
  )
}
