import { useContext, useEffect, useState } from 'react'
import { OcrNavigationContext } from './OcrNavigation'
import { currentMilkDate } from '../../server/milkDocumentDate.js'

export function useMilkRecordAccess() {
  const isAdmin = useContext(OcrNavigationContext)?.user?.isAdmin === true
  const [today, setToday] = useState(currentMilkDate)
  useEffect(() => {
    const refresh = () => setToday(currentMilkDate())
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  const canEditDate = (date: string | undefined) => isAdmin || date === currentMilkDate()
  return { isAdmin, today, canEditDate, lockedMessage: 'Only administrators can change records outside the current day.' }
}
