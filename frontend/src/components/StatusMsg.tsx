export interface Msg { ok: boolean; text: string }

/** Inline save/error feedback next to a button. Renders nothing when unset. */
export default function StatusMsg({ msg }: { msg: Msg | null }) {
  if (!msg) return null
  return <span className={`status-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</span>
}
