import { LayoutDashboard, Dumbbell, MapIcon, Activity, BarChart2 } from 'lucide-react'

type Page = 'dashboard' | 'workouts' | 'heatmap' | 'timeline' | 'analysis' | 'help'

interface BottomBarProps {
  currentPage: Page
  onNavigate: (page: Page) => void
}

const ITEMS: { id: Page; label: string; icon: React.ReactNode }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={22} /> },
  { id: 'workouts', label: 'Workouts', icon: <Dumbbell size={22} /> },
  { id: 'heatmap', label: 'Heatmap', icon: <MapIcon size={22} /> },
  { id: 'timeline', label: 'Timeline', icon: <Activity size={22} /> },
  { id: 'analysis', label: 'Analysis', icon: <BarChart2 size={22} /> },
]

export default function BottomBar({ currentPage, onNavigate }: BottomBarProps) {
  return (
    <nav className="bottom-bar">
      {ITEMS.map(item => (
        <button
          key={item.id}
          className={`bottom-bar-item ${currentPage === item.id ? 'active' : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}
