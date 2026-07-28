import { MOBILE_PAGES, type Page } from '../lib/nav'
import { PAGE_META } from './Sidebar'

interface BottomBarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
}

export default function BottomBar({ currentPage, onNavigate }: BottomBarProps) {
  return (
    <nav className="bottom-bar">
      {MOBILE_PAGES.map(page => {
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
    </nav>
  )
}
