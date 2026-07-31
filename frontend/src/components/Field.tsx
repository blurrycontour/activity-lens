import InfoTip from './InfoTip'

interface FieldProps {
  label: string
  /** The "why" behind this control, shown in a `?` bubble beside the label. */
  info?: string
  /** Short note under the control, for things a tooltip shouldn't hide. */
  hint?: string
  /** The value comes from the environment and can't be edited here. */
  overridden?: boolean
  children: React.ReactNode
}

/**
 * Label + control, with the label in the app's mono micro-label style.
 *
 * Three pages each defined their own version of this and the label style was
 * copy-pasted thirty times. Explanations belong in `info` rather than in a
 * paragraph above the control: settings pages were carrying more prose than
 * controls, and a tooltip puts the answer next to the question.
 */
export default function Field({ label, info, hint, overridden, children }: FieldProps) {
  return (
    <div className="field">
      <span className="field-label">
        {label}
        {info && <InfoTip text={info} />}
        {overridden && <span className="field-badge">set by .env</span>}
      </span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  )
}
