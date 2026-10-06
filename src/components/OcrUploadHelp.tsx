import { useCallback, useRef, useState, type ComponentType, type RefObject } from 'react'
import { CircleQuestionMark, LoaderCircle } from 'lucide-react'
import type { OcrUploadWalkthroughProps } from './OcrUploadWalkthrough'
import './OcrUploadHelp.css'

export function OcrUploadHelp({ screenRef, isRo, disabled }: {
  screenRef: RefObject<HTMLDivElement | null>
  isRo: boolean
  disabled: boolean
}) {
  const [Guide, setGuide] = useState<ComponentType<OcrUploadWalkthroughProps> | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }))
  }, [])

  async function start() {
    if (loading) return
    setError(false)
    setLoading(true)
    try {
      const module = await import('./OcrUploadWalkthrough')
      setGuide(() => module.default)
      setOpen(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const label = isRo ? 'Ghid OCR pas cu pas' : 'OCR step-by-step guide'
  return <>
    <button ref={trigger} type="button" className="ocr-help-button" onClick={start}
      disabled={disabled || loading} aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} aria-busy={loading}>
      {loading ? <LoaderCircle size={22} aria-hidden="true" /> : <CircleQuestionMark className="ocr-help-question" size={28} aria-hidden="true" />}
    </button>
    {error && <span className="ocr-help-error" role="alert">{isRo ? 'Ghidul nu s-a încărcat. Încercați din nou.' : 'The guide could not load. Please try again.'}</span>}
    {open && Guide && screenRef.current && <Guide screen={screenRef.current} isRo={isRo} onClose={close} />}
  </>
}
