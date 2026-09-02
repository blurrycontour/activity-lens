/** A two- or three-option segmented toggle, e.g. a chart's Total/Best switch. */
export default function Segmented<T extends string>({ value, onChange, options, ariaLabel }: {
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string }[]
  ariaLabel?: string
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.id}
          className={value === o.id ? 'active' : undefined}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
