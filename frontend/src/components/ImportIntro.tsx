import { FolderSync, Import, PenLine, Share2, Upload, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { isNative } from '../lib/serverConfig'
import Modal from './Modal'

/**
 * The "here is how you get your workouts in" welcome.
 *
 * Shown once per user per device. Not once per account: the answer is different
 * on a phone than on a laptop — folder watching only exists in the app, "open
 * with" only on the desktop — so someone who saw this on one device has not
 * been told what the other one can do.
 *
 * A device-local record rather than a column on the user, deliberately. It is a
 * fact about this browser, it is worth nothing if it is lost, and syncing it
 * would mean the second device silently never explains itself.
 */
const SEEN_KEY_PREFIX = 'al_import_intro_seen_'

function seenKey(userId: number | string): string {
  return `${SEEN_KEY_PREFIX}${userId}`
}

/** Whether this user has already been shown the introduction on this device. */
export function hasSeenImportIntro(userId: number | string): boolean {
  try {
    return localStorage.getItem(seenKey(userId)) !== null
  } catch {
    // Storage disabled or full. Treated as "already seen": a welcome that
    // cannot be dismissed permanently is worse than one nobody sees.
    return true
  }
}

export function markImportIntroSeen(userId: number | string): void {
  try {
    localStorage.setItem(seenKey(userId), new Date().toISOString())
  } catch {
    // Nothing to do; see above.
  }
}

interface Route {
  icon: ReactNode
  title: string
  body: string
}

/**
 * The ways in, narrowed to the ones this device actually has.
 *
 * Listing a route that does not exist here is worse than listing nothing: it
 * sends someone looking for a button that was never rendered.
 */
function routesFor(native: boolean): Route[] {
  const routes: Route[] = [
    {
      icon: <Upload size={16} />,
      title: 'Pick files',
      body: 'The Add workout button takes GPX and TCX files — as many at once as you like, including a .zip straight from Strava or Garmin.',
    },
    {
      icon: <Share2 size={16} />,
      title: 'Share from another app',
      body: native
        ? 'Share a workout file from any app — a file manager, email, your watch’s own app — and pick Activity Lens.'
        : 'On a phone, share a workout file from another app and pick Activity Lens.',
    },
  ]
  if (native) {
    routes.push({
      icon: <FolderSync size={16} />,
      title: 'Watch a folder',
      body: 'Point Activity Lens at the folder your watch syncs to and new workouts import themselves, in the background. Settings → Auto import.',
    })
  } else {
    routes.push({
      icon: <Import size={16} />,
      title: 'Open with',
      body: 'With the app installed on a desktop, double-clicking a GPX or TCX file can open it straight into the import screen.',
    })
  }
  routes.push({
    icon: <PenLine size={16} />,
    title: 'Type it in',
    body: 'No file? Add a workout by hand — a name, a date, a distance and a duration is enough.',
  })
  return routes
}

interface ImportIntroProps {
  onClose: () => void
}

export default function ImportIntro({ onClose }: ImportIntroProps) {
  const routes = routesFor(isNative())

  return (
    <Modal onClose={onClose} label="Importing workouts">
        <div className="modal-box import-intro">
          <button
            className="btn-icon"
            onClick={onClose}
            aria-label="Close"
            style={{ position: 'absolute', top: 14, right: 14 }}
          >
            <X size={15} />
          </button>
          <h3 id="import-intro-title" className="import-intro-title">Getting your workouts in</h3>
          <p className="import-intro-lead">
            There are a few ways, and you can mix them freely — Activity Lens skips
            anything it already has, so nothing is ever imported twice.
          </p>

          <ul className="import-intro-list">
            {routes.map(route => (
              <li key={route.title} className="import-intro-route">
                <span className="import-intro-icon" aria-hidden="true">{route.icon}</span>
                <div>
                  <div className="import-intro-route-title">{route.title}</div>
                  <p className="import-intro-route-body">{route.body}</p>
                </div>
              </li>
            ))}
          </ul>

          {/* One button, and it only dismisses.
              An "Import a workout" action here would open the import screen and
              close this for good — so anyone who tapped it to see what happens
              has spent their one showing, and there is no way back to a window
              they may not have finished reading. Acknowledging is the only thing
              this window is for. */}
          <div className="import-intro-actions">
            <button className="btn btn-primary" onClick={onClose}>Okay! Got it.</button>
          </div>
        </div>
    </Modal>
  )
}
