import { goalProgress, weekStartKey, recentWeekStarts } from './src/lib/insights.ts'

const today = new Date()
const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
console.log('today            =', todayKey, '(', ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][today.getDay()], ')')
console.log('weekStartKey     =', weekStartKey(todayKey))
console.log('recentWeekStarts =', recentWeekStarts(1))

const mk = (date: string, o: any = {}) => ({ id: date, name: 'W', type: 'Run', date, duration: 1800,
  distance: 5000, avgHR: 150, maxHR: 170, elevationGain: 0, calories: 300, avgPace: 300, avgSpeed: 12,
  route: [], hrTimeline: [], paceTimeline: [], elevTimeline: [], ...o }) as any

for (const [label, goal, w] of [
  ['exactly 5km run, goal 5km',      { count: 2, type: 'Run', minKm: 5 },  mk(todayKey, { distance: 5000 })],
  ['4.9km run, goal 5km',            { count: 2, type: 'Run', minKm: 5 },  mk(todayKey, { distance: 4900 })],
  ['run, goal any/no min',           { count: 2, type: '',    minKm: 0 },  mk(todayKey)],
  ['run, goal Run/no min',           { count: 2, type: 'Run', minKm: 0 },  mk(todayKey)],
  ['goal minKm as STRING "5"',       { count: 2, type: 'Run', minKm: '5' as any }, mk(todayKey)],
  ['goal count as STRING "2"',       { count: '2' as any, type: 'Run', minKm: 0 }, mk(todayKey)],
] as const) {
  const p = goalProgress([w], goal as any)
  console.log(`${String(label).padEnd(34)} thisWeek=${p.thisWeek}`)
}
