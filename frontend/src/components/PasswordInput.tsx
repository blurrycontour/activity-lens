import { useId, useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff, AlertTriangle } from 'lucide-react'

interface PasswordInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Warn while Caps Lock is on. Worth it on sign-in, noise everywhere else. */
  capsLockWarning?: boolean
}

/**
 * Password field with a reveal toggle.
 *
 * Deliberately uncontrolled about visibility: it always mounts masked, so a
 * revealed password can never survive a remount or be restored from anywhere.
 * The toggle is `type="button"` (it would otherwise submit the surrounding
 * form) and is skipped by Tab, so the path from password to submit is
 * unchanged for keyboard users.
 */
export default function PasswordInput({
  capsLockWarning,
  className = '',
  style,
  onKeyUp,
  onBlur,
  ...rest
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const [caps, setCaps] = useState(false)
  const hintId = useId()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ position: 'relative', display: 'flex' }}>
        <input
          {...rest}
          type={visible ? 'text' : 'password'}
          className={`input ${className}`.trim()}
          // Room for the toggle, which sits inside the field.
          style={{ width: '100%', paddingRight: 36, ...style }}
          aria-describedby={caps ? hintId : undefined}
          onKeyUp={e => {
            if (capsLockWarning) setCaps(e.getModifierState('CapsLock'))
            onKeyUp?.(e)
          }}
          onBlur={e => {
            setCaps(false)
            onBlur?.(e)
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          // A disabled field's value is not the user's to inspect.
          disabled={rest.disabled}
          onClick={() => setVisible(v => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          className="btn-icon"
          style={{
            position: 'absolute',
            right: 2,
            top: '50%',
            transform: 'translateY(-50%)',
            padding: 5,
          }}
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {caps && (
        <span id={hintId} className="caps-hint">
          <AlertTriangle size={12} /> Caps Lock is on
        </span>
      )}
    </div>
  )
}
