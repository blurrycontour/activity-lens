import { useState } from 'react'

/**
 * A number input you can actually empty.
 *
 * The obvious spelling — clamp on every keystroke — makes a field that cannot
 * be retyped: deleting the 3 from "30" puts a 3 straight back, so the only way
 * to reach 5 is to select the text first. Every numeric field in the plan
 * editor had grown its own half-answer to this, and they disagreed.
 *
 * So: while it is being typed in, the field holds whatever you have typed,
 * including nothing. The floor is applied when you leave. `min` is what an
 * empty field means on blur — 1 for a count of sets, 0 for a rest that is
 * simply not set.
 */
export default function NumberField({
  value, onChange, min = 0, max, step, decimal, placeholder, ariaLabel, className, id,
}: {
  value: number
  onChange: (n: number) => void
  /** Both the floor and what an empty field settles to. */
  min?: number
  max?: number
  step?: number | string
  /** Accepts halves, for kilograms. */
  decimal?: boolean
  placeholder?: string
  ariaLabel?: string
  className?: string
  id?: string
}) {
  // Only while focused. Kept out of the parent's state so a value arriving
  // from elsewhere — an autosave answering, a plan reloading — still shows.
  const [draft, setDraft] = useState<string | null>(null)

  return (
    <input
      id={id}
      className={className ?? 'input'}
      type="number"
      inputMode={decimal ? 'decimal' : 'numeric'}
      min={min}
      max={max}
      step={step ?? (decimal ? 0.5 : 1)}
      placeholder={placeholder}
      aria-label={ariaLabel}
      value={draft ?? (value || '')}
      onFocus={() => setDraft(value ? String(value) : '')}
      onChange={e => {
        setDraft(e.target.value)
        const n = decimal ? parseFloat(e.target.value) : parseInt(e.target.value, 10)
        if (!Number.isFinite(n)) return
        onChange(clamp(n, min, max))
      }}
      onBlur={() => {
        const n = decimal ? parseFloat(draft ?? '') : parseInt(draft ?? '', 10)
        onChange(Number.isFinite(n) ? clamp(n, min, max) : min)
        setDraft(null)
      }}
    />
  )
}

function clamp(n: number, min: number, max?: number): number {
  return Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, n))
}
