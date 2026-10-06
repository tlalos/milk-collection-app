import { useCallback, useRef, useState, type ComponentType } from 'react'
import { CircleQuestionMark, LoaderCircle } from 'lucide-react'
import { useOcrLanguage } from './OcrLanguage'
import type { ReviewWalkthroughProps } from './ReviewWalkthrough'
import './ReviewHelp.css'

export function ReviewHelp({ kind, onStart, disabled = false }: { kind: 'daily' | 'monthly'; onStart: () => void; disabled?: boolean }) {
  const { isRo } = useOcrLanguage()
  const trigger = useRef<HTMLButtonElement>(null)
  const [Guide, setGuide] = useState<ComponentType<ReviewWalkthroughProps> | null>(null)
  const [screen, setScreen] = useState<HTMLElement | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const close = useCallback(() => {
    setScreen(null)
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
  }, [])
  async function start() {
    if (loading || disabled) return
    setLoading(true)
    setError(false)
    try {
      const module = await import('./ReviewWalkthrough')
      const parent = trigger.current?.closest<HTMLElement>(kind === 'daily' ? '.review-screen' : '.monthly-review')
      if (!parent) return
      onStart()
      setGuide(() => module.default)
      setScreen(parent)
    } catch { setError(true) }
    finally { setLoading(false) }
  }
  const label = isRo ? 'Ghid de verificare' : 'Review guide'
  return <>
    <button ref={trigger} className="review-help-button" type="button" onClick={start} disabled={disabled || loading}
      aria-label={label} title={disabled ? (isRo ? 'Așteptați salvarea modificărilor înainte de a porni ghidul.' : 'Finish saving changes before starting the guide.') : label}
      aria-haspopup="dialog" aria-expanded={Boolean(screen)} aria-busy={loading}>
      {loading ? <LoaderCircle size={22} aria-hidden="true" /> : <CircleQuestionMark size={28} className="review-help-question" aria-hidden="true" />}
    </button>
    {error && <span role="alert">{isRo ? 'Ghidul nu s-a încărcat. Încercați din nou.' : 'Could not load the guide. Please try again.'}</span>}
    {screen && Guide && <Guide screen={screen} kind={kind} onClose={close} />}
  </>
}
