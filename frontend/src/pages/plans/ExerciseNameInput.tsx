import { useEffect, useId, useMemo, useRef, useState } from 'react'

/**
 * The exercise name field, with suggestions from names already in use.
 *
 * People write the same twenty exercise names over and over, and "Incline
 * dumbbell press" is a lot to retype on a phone. The caller supplies the list:
 * the plan being edited first, then every name on the account, so a name typed
 * on a phone turns up on a laptop.
 *
 * Free text either way: a suggestion is a shortcut, never a constraint.
 */
export default function ExerciseNameInput({ value, onChange, suggestions, className }: {
  value: string
  onChange: (v: string) => void
  /** Every name already used, deduplicated by the caller. */
  suggestions: string[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const wrap = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase()
    // An empty field offers the most recent names rather than nothing: that is
    // the moment a suggestion saves the most typing.
    const pool = q
      ? suggestions.filter(s => s.toLowerCase().includes(q) && s.toLowerCase() !== q)
      : suggestions
    return pool.slice(0, 6)
  }, [value, suggestions])

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  function pick(name: string) {
    onChange(name)
    setOpen(false)
    setHighlight(-1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => (h + 1) % matches.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => (h <= 0 ? matches.length - 1 : h - 1))
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault()
      pick(matches[highlight])
    } else if (e.key === 'Escape') {
      // Only the list closes. Escape inside a field should not also be read by
      // whatever is behind it.
      e.stopPropagation()
      setOpen(false)
    }
  }

  function onFocus() {
    setOpen(true)
    // On a phone, focusing this field raises the keyboard and opens the
    // suggestion list at once, and between them the browser's own scroll leaves
    // the field behind the keyboard — unlike the plain number fields beside it.
    // Once both have settled, bring the input itself back into view. Guarded to
    // touch pointers so a desktop click does not jump the page.
    if (window.matchMedia('(pointer: coarse)').matches) {
      setTimeout(() => input.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300)
    }
  }

  return (
    <div className="plan-name-field" ref={wrap}>
      <input
        ref={input}
        className={className ?? 'input'}
        value={value}
        placeholder="Bench press"
        aria-label="Exercise name"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); setHighlight(-1) }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
      />
      {open && matches.length > 0 && (
        <ul className="plan-suggest" id={listId} role="listbox">
          {matches.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`plan-suggest-item${i === highlight ? ' on' : ''}`}
                // pointerdown, not click: the input's blur would otherwise
                // close the list before the click landed.
                onPointerDown={e => { e.preventDefault(); pick(s) }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const RECENT_KEY = 'al_exercise_names'
const MAX_RECENT = 60

/** Names this device has used before, newest first. */
export function recentExerciseNames(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]).filter(s => typeof s === 'string') : []
  } catch {
    return []
  }
}

/** Remembers a name that was actually saved, so it can be offered next time. */
export function rememberExerciseNames(names: string[]): void {
  const clean = names.map(n => n.trim()).filter(Boolean)
  if (clean.length === 0) return
  try {
    const merged = [...clean, ...recentExerciseNames()]
    // Case-insensitive dedupe keeping the first spelling seen, so "Bench Press"
    // typed today does not sit beside "bench press" from last month.
    const seen = new Set<string>()
    const out: string[] = []
    for (const n of merged) {
      const key = n.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(n)
      if (out.length >= MAX_RECENT) break
    }
    localStorage.setItem(RECENT_KEY, JSON.stringify(out))
  } catch {
    // Suggestions are a convenience; a full store is not worth an error.
  }
}
