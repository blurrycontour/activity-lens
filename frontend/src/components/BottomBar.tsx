import { useEffect, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { BOTTOM_BAR_PAGES, MORE_PAGES, type Page } from '../lib/nav'
import { PAGE_META } from './Sidebar'

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

  // Navigating away by any route — a swipe, a deep link, the back gesture —
  // should not leave the sheet hanging over the page it landed on.
  useEffect(() => { setOpen(false) }, [currentPage])

  return (
    <>
      {open && (
        <>
          <div className="overlay" onClick={() => setOpen(false)} />
          <div className="more-sheet" role="dialog" aria-modal="true" aria-label="More pages">
            {MORE_PAGES.map(page => {
              const meta = PAGE_META[page]
              if (!meta) return null
              return (
                <button
                  key={page}
                  className={`more-sheet-item${currentPage === page ? ' active' : ''}`}
                  onClick={() => { setOpen(false); onNavigate(page) }}
                >
                  {meta.icon(19)}
                  <span>{meta.label}</span>
                </button>
              )
            })}
          </div>
        </>
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
              {meta.icon(21)}
              <span>{meta.label}</span>
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
          <span>{inMore ? PAGE_META[currentPage]?.label ?? 'More' : 'More'}</span>
        </button>
      </nav>
    </>
  )
}
