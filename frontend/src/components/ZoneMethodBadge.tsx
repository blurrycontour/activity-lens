/** Which HR-zone model produced a chart's zones, set in Body & performance
 *  settings. A quiet pill, shared by the workout and Analysis zone charts. */
export default function ZoneMethodBadge({ method }: { method: 'max' | 'reserve' }) {
  const reserve = method === 'reserve'
  return (
    <span
      className="zone-method-badge"
      title={reserve
        ? 'Zones from heart-rate reserve (Karvonen), using your resting and max HR — set in Body & performance'
        : 'Zones from a percentage of your max HR — set in Body & performance'}
    >
      {reserve ? 'Karvonen' : '% max'}
    </span>
  )
}
