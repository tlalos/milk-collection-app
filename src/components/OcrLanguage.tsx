import { useState } from 'react'
import './OcrLanguage.css'

export type OcrLanguage = 'en' | 'ro'

export function useOcrLanguage() {
  const [language, setLanguageState] = useState<OcrLanguage>(() => localStorage.getItem('ocr-language') === 'ro' ? 'ro' : 'en')
  function setLanguage(next: OcrLanguage) {
    localStorage.setItem('ocr-language', next)
    setLanguageState(next)
  }
  return { language, setLanguage, isRo: language === 'ro' }
}

export function OcrLanguageSwitch({ language, onChange }: { language: OcrLanguage; onChange: (language: OcrLanguage) => void }) {
  return (
    <div className="ocr-language-switch" aria-label={language === 'ro' ? 'Selectați limba' : 'Select language'}>
      <button className={language === 'en' ? 'active' : ''} type="button" onClick={() => onChange('en')}>EN</button>
      <button className={language === 'ro' ? 'active' : ''} type="button" onClick={() => onChange('ro')}>RO</button>
    </div>
  )
}
