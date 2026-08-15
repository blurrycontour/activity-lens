import { X } from 'lucide-react'
import useDismissOnBack from '../lib/useDismissOnBack'
import Modal from './Modal'

/**
 * A panel that takes over the screen: the expanded chart, the expanded map.
 *
 * Shared rather than copied because the three things that make it work are all
 * easy to leave out, and each one fails in a way that looks like something
 * else:
 *
 *   - it sits inside Modal, which portals it to the body. Pages render inside
 *     the swipe pager, which is `position: relative; z-index: 1` — a stacking
 *     context — so a fixed child's z-index applies only *within the page* and
 *     the top and bottom bars stay on top of it however large the number is;
 *   - the back gesture closes it instead of navigating away, which on a phone
 *     is the first thing anyone tries;
 *   - it has a visible close button, which is the only way out on a device with
 *     no keyboard.
 */
export default function ExpandModal({ title, onClose, children, variant }: {
  title: string
  onClose: () => void
  children: React.ReactNode
  /**
   * 'map' drops the card's padding and lets the content run to the edges. On a
   * phone that is the difference between a map in a box inside a scrolling page
   * and a map you can actually read a route on.
   */
  variant?: 'map'
}) {
  useDismissOnBack(true, onClose)

  const map = variant === 'map'
  return (
    <Modal onClose={onClose} wrapper="none" label={title}>
      <div className={`modal modal-expand${map ? ' modal-immersive' : ''}`}>
        <div className={`modal-box modal-box-expand${map ? ' modal-box-immersive' : ''}`}>
          <div className={map ? 'modal-immersive-head' : 'modal-expand-head'}>
            <h3 style={{ fontSize: 15, fontWeight: 700 }}>{title}</h3>
            <button className="btn-icon" onClick={onClose} title="Close" aria-label="Close"><X size={18} /></button>
          </div>
          {map ? children : (
            <div className="modal-expand-body">
              <div className="modal-expand-inner">{children}</div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
