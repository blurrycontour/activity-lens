import { ShieldAlert } from 'lucide-react'

/**
 * Says plainly that this connection is not encrypted.
 *
 * Worth being blunt about, because the failure is invisible: everything works,
 * and the only sign that a password, a session and a year of training data are
 * readable by anyone on the same network is this notice. It is deliberately not
 * softened into "consider using HTTPS".
 *
 * There is no client-side mitigation to offer instead. Hashing the password in
 * the browser is the usual suggestion and it does nothing: the hash becomes the
 * credential and replays just as well, and the session token that comes back
 * travels in the clear regardless — as does every request it authenticates. The
 * only fix is TLS, so that is the only thing this suggests.
 */
export default function InsecureWarning({ compact }: { compact?: boolean }) {
  return (
    <div className="insecure-warning" role="alert">
      <ShieldAlert size={compact ? 15 : 17} aria-hidden />
      <div>
        <strong>This connection is not encrypted.</strong>
        {!compact && (
          <p>
            Your password, your session and everything you do here travel in plain text over
            <code> http://</code>, and anyone between this device and the server — on the same
            Wi‑Fi, or anywhere along the route — can read and change them. Put the server behind
            HTTPS before using it over any network you do not control.
          </p>
        )}
      </div>
    </div>
  )
}
