import { LayoutDashboard, Dumbbell, MapIcon, Activity, BarChart2 } from 'lucide-react'

import { MOBILE_PAGES, type Page } from '../lib/nav'

interface BottomBarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
}

// Presentation for the pages in MOBILE_PAGES, which also fixes the swipe order.
const ITEMS: Partial<Record<Page, { label: string; icon: React.ReactNode }>> = {
  dashboard: { label: 'Dashboard', icon: <LayoutDashboard size={22} /> },
  workouts: { label: 'Workouts', icon: <Dumbbell size={22} /> },
  heatmap: { label: 'Heatmap', icon: <MapIcon size={22} /> },
  timeline: { label: 'Timeline', icon: <Activity size={22} /> },
  analysis: { label: 'Analysis', icon: <BarChart2 size={22} /> },
}

export default function BottomBar({ currentPage, onNavigate }: BottomBarProps) {
  return (
    <nav className="bottom-bar">
      {MOBILE_PAGES.map(page => {
        const item = ITEMS[page]
        if (!item) return null
        return (
          <button
            key={page}
            className={`bottom-bar-item ${currentPage === page ? 'active' : ''}`}
            onClick={() => onNavigate(page)}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
