import { createPortal } from 'react-dom'
import useDismissOnBack from '../lib/useDismissOnBack'

/**
 * The backdrop and centring every dialog in the app sits in.
 *
 * It exists because the two lines it replaces have to be right in a way that
 * is easy to get wrong and invisible in development. Pages render inside the
 * swipe pager, which is `position: relative; z-index: 1` — a stacking context —
 * so a dialog rendered in place is *bounded by it* however large its own
 * z-index: on a phone the top and bottom bars painted straight over the top of
 * it. Portalling to the body is what fixes that, and doing it here means no
 * dialog can be written without it.
 *
 * Every dialog therefore behaves the same: the page dims and blurs behind it,
 * nothing underneath can be tapped through, a tap outside dismisses, and
 * Escape and the system back gesture close it.
 *
 * Back is handled here rather than by each dialog because getting it wrong is
 * invisible on a desktop and awful on a phone: nothing in the page knows a
 * dialog is up, so back reached the router and navigated away, dropping the
 * user a page back from where they were with their dialog silently gone. Three
 * dialogs had solved it locally; the other thirteen had not.
 */
export default function Modal({ onClose, children, dismissable = true, wrapper = 'modal', label, onBack }: {
  /** Dismiss, from the backdrop. Omit `dismissable` to make the backdrop inert. */
  onClose?: () => void
  children: React.ReactNode
  /**
   * Whether a tap on the backdrop closes. False while work is in flight, where
   * dismissing would leave the caller unsure whether it finished.
   */
  dismissable?: boolean
  /**
   * 'modal' centres the child in the viewport; 'none' hands the positioning to
   * the child, for the bottom sheet, which pins itself to the bottom edge.
   */
  wrapper?: 'modal' | 'none'
  /** Names the dialog for assistive tech when the child does not. */
  label?: string
  /**
   * What back and Escape do, when that is not simply "dismiss" — a dialog with
   * a confirmation step inside it wants back to close that step first, one
   * surface at a time. Rarely needed; the default is right nearly always.
   */
  onBack?: () => void
}) {
  /*
   * `true`, not `dismissable`: the history entry has to exist even while a
   * dialog refuses to be dismissed, or back escapes to the page underneath —
   * which is the very thing this prevents. Non-dismissable means the gesture
   * does nothing, not that it does something worse.
   */
  useDismissOnBack(true, onBack ?? (() => { if (dismissable) onClose?.() }))

  return createPortal(
    <>
      <div className="overlay" onClick={dismissable ? onClose : undefined} />
      {wrapper === 'modal'
        ? (
          // The role goes here only when this is the thing being named. Several
          // dialogs label their own box, and nesting two dialog roles is worse
          // for a screen reader than having one in the right place.
          <div className="modal" role={label ? 'dialog' : undefined} aria-modal={label ? true : undefined} aria-label={label}>
            {children}
          </div>
        )
        : children}
    </>,
    document.body,
  )
}
