import type { ButtonHTMLAttributes } from 'react'
import { ArrowLeft } from 'lucide-react'
import './BackButton.css'

type BackButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

export function BackButton({ className = '', title, 'aria-label': label = 'Back', ...props }: BackButtonProps) {
  return <button {...props} type="button" className={`app-back-button ${className}`} aria-label={label} title={title || label}>
    <ArrowLeft size={20} strokeWidth={2} aria-hidden="true" />
  </button>
}
