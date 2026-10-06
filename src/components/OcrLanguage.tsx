import { useSyncExternalStore } from 'react'
import './OcrLanguage.css'

export type OcrLanguage = 'en' | 'ro'

function readLanguage(): OcrLanguage {
  return localStorage.getItem('ocr-language') === 'ro' ? 'ro' : 'en'
}

function subscribeLanguage(onChange: () => void) {
  function onStorage(event: StorageEvent) {
    if (event.key === 'ocr-language' || event.key === null) onChange()
  }
  window.addEventListener('ocr-language-change', onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener('ocr-language-change', onChange)
    window.removeEventListener('storage', onStorage)
  }
}

function setLanguage(next: OcrLanguage) {
  localStorage.setItem('ocr-language', next)
  window.dispatchEvent(new Event('ocr-language-change'))
}

export function useOcrLanguage() {
  const language = useSyncExternalStore(subscribeLanguage, readLanguage)
  return { language, setLanguage, isRo: language === 'ro' }
}

export function OcrLanguageSwitch({ language, onChange }: { language: OcrLanguage; onChange: (language: OcrLanguage) => void }) {
  return (
    <div className="ocr-language-switch" role="group" aria-label="Language">
      <button className={language === 'en' ? 'active' : ''} type="button" aria-label="English" aria-pressed={language === 'en'} title="English" onClick={() => onChange('en')}>EN</button>
      <button className={language === 'ro' ? 'active' : ''} type="button" aria-label="Romanian" aria-pressed={language === 'ro'} title="Romanian" onClick={() => onChange('ro')}>RO</button>
    </div>
  )
}

// Pages without translations can already remember the user's language choice.
export function PageLanguageSwitch() {
  const { language, setLanguage } = useOcrLanguage()
  return <OcrLanguageSwitch language={language} onChange={setLanguage} />
}
