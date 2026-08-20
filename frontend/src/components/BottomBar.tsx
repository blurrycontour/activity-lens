import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, X } from 'lucide-react'
import { BOTTOM_BAR_PAGES, MORE_PAGES, type Page } from '../lib/nav'
import { useActiveSession } from '../context/ActiveSessionContext'
import { PAGE_META } from './Sidebar'
import useSheetDrag from '../lib/useSheetDrag'
import Modal from './Modal'

interface BottomBarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
}

/**
 * The phone's primary navigation: four tabs and a More sheet.
 *
 * Four because a tab bar is thumb-sized targets and readable labels, and both
 * shrink as items are added. Six across a phone leaves each tab narrower than
 * the finger meant to hit it and starts eliding the labels — which is what
 * adding the map did. Nothing is lost: More holds the rest, and it highlights
 * when one of them is open, so the bar never claims you are nowhere.
 */
export default function BottomBar({ currentPage, onNavigate }: BottomBarProps) {
  const [open, setOpen] = useState(false)
  const inMore = MORE_PAGES.includes(currentPage)
  const { active } = useActiveSession()
  const bodyRef = useRef<HTMLDivElement>(null)
  const sheet = useSheetDrag(() => setOpen(false), bodyRef)

  // Navigating away by any route — a swipe, a deep link, the back gesture —
  // should not leave the sheet hanging over the page it landed on.
  useEffect(() => { setOpen(false) }, [currentPage])

  return (
    <>
      {/* The app's own bottom sheet, not a bespoke panel: it already has the
          grab handle, the safe-area padding, the entry animation and — the part
          that matters — a z-index that clears the overlay. A hand-rolled one at
          z-index 60 sat behind the blur and showed nothing at all. */}
      {open && (
        <Modal onClose={() => setOpen(false)} wrapper="none">
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label="More pages"
            {...sheet.handlers}
            style={sheet.style}
          >
            <div className="sheet-grab" aria-hidden="true" />
            <div className="sheet-head">
              <h3 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>More</h3>
              <button className="btn-icon" onClick={() => setOpen(false)} aria-label="Close"><X size={16} /></button>
            </div>
            <div className="sheet-body" ref={bodyRef}>
              {MORE_PAGES.map(page => {
                const meta = PAGE_META[page]
                if (!meta) return null
                return (
                  <button
                    key={page}
                    className={`more-item${currentPage === page ? ' active' : ''}`}
                    onClick={() => { setOpen(false); onNavigate(page) }}
                  >
                    {meta.icon(19)}
                    <span>{meta.label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </Modal>
      )}

      <nav className="bottom-bar">
        {BOTTOM_BAR_PAGES.map(page => {
          const meta = PAGE_META[page]
          if (!meta) return null
          return (
            <button
              key={page}
              className={`bottom-bar-item ${currentPage === page ? 'active' : ''}`}
              onClick={() => onNavigate(page)}
            >
              {/* The dot is positioned against the icon, so the icon needs to
                  be what it is positioned against — loose in the button it
                  found the bar itself and pinned itself to the far corner. */}
              <span className="nav-icon">
                {meta.icon(21)}
                {/* A session left running is the one thing in this app that
                    keeps going while you are elsewhere, so the way back to it
                    is marked from every page. Not while you are on Plans: the
                    page itself already carries a full resume card. */}
                {page === 'plans' && active && currentPage !== 'plans' && (
                  <span className="nav-live-dot" role="img" aria-label="Session in progress" />
                )}
              </span>
              <span className="bottom-bar-label">{meta.label}</span>
            </button>
          )
        })}
        <button
          className={`bottom-bar-item ${inMore ? 'active' : ''}`}
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-haspopup="menu"
        >
          <MoreHorizontal size={21} />
          {/* Named for where you are when you are behind it, so the bar still
              answers "which page is this" from four tabs. */}
          <span className="bottom-bar-label">{inMore ? PAGE_META[currentPage]?.label ?? 'More' : 'More'}</span>
        </button>
      </nav>
    </>
  )
}
