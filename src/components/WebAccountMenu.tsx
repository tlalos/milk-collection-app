import { useEffect, useId, useRef, useState } from 'react'
import { LogOut } from 'lucide-react'
import './WebAccountMenu.css'

interface WebAccountMenuProps {
  username: string
  onSignOut: () => void | Promise<void>
  isRo?: boolean
}

export function WebAccountMenu({ username, onSignOut, isRo = false }: WebAccountMenuProps) {
  const [open, setOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const logout = useRef<HTMLButtonElement>(null)
  const id = useId()
  const label = `${isRo ? 'Cont web' : 'Web account'}: ${username}`
  const initials = Array.from(username.trim().toUpperCase()).filter(character => /[\p{L}\p{N}]/u.test(character)).slice(0, 2).join('') || '?'

  useEffect(() => {
    if (!open) return
    logout.current?.focus()
    function outside(event: PointerEvent | FocusEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  async function signOut() {
    if (signingOut) return
    setSigningOut(true)
    setError('')
    try {
      await onSignOut()
      setOpen(false)
    } catch {
      setError(isRo ? 'Deconectarea a eșuat. Încercați din nou.' : 'Log out failed. Please try again.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="web-account" ref={root}>
      <button ref={trigger} className="web-account-trigger" type="button" title={label} aria-label={label}
        aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
        onClick={() => setOpen(current => !current)}>
        {initials}
      </button>
      {open && (
        <div id={id} className="web-account-popover" role="dialog" aria-label={label}>
          <strong className="web-account-username">{username}</strong>
          <button ref={logout} className="web-account-logout" type="button" disabled={signingOut} onClick={() => void signOut()}>
            <LogOut size={16} aria-hidden="true" />
            {signingOut ? (isRo ? 'Deconectare...' : 'Logging out...') : (isRo ? 'Deconectare' : 'Log out')}
          </button>
          {error && <p className="web-account-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  )
}
