import { useCallback, useRef, useState, type ComponentType, type RefObject } from 'react'
import { CircleHelp } from 'lucide-react'
import type { SignInWalkthroughProps } from './SignInWalkthrough'
import './WebSignInHelp.css'

export function WebSignInHelp({ formRef, isRo = false }: { formRef: RefObject<HTMLFormElement | null>; isRo?: boolean }) {
  const [Tour, setTour] = useState<ComponentType<SignInWalkthroughProps> | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useCallback((completed = false) => {
    setOpen(false)
    setMessage(completed
      ? (isRo ? 'Ghid încheiat. Acum vă puteți autentifica.' : 'Guide complete. You can now sign in.')
      : '')
    trigger.current?.focus()
  }, [isRo])

  async function start() {
    setLoading(true)
    setMessage('')
    try {
      const module = await import('./SignInWalkthrough')
      setTour(() => module.default)
      setOpen(true)
    } catch {
      setMessage(isRo ? 'Ghidul nu s-a încărcat. Încercați din nou.' : 'The guide could not load. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return <div className="web-sign-in-help">
    <button ref={trigger} type="button" className="web-sign-in-help-trigger" disabled={loading}
      onClick={() => void start()} title={isRo ? 'Ghid de autentificare pas cu pas' : 'Step-by-step sign-in guide'}>
      <CircleHelp size={17} aria-hidden="true" />
      {loading ? (isRo ? 'Se încarcă...' : 'Loading...') : (isRo ? 'Ghid pas cu pas' : 'Step-by-step help')}
    </button>
    {message && <p role="status" className="web-sign-in-help-message">{message}</p>}
    {open && Tour && formRef.current && <Tour form={formRef.current} isRo={isRo} onClose={close} />}
  </div>
}
