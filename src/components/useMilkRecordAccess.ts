import { useContext, useEffect, useState } from 'react'
import { OcrNavigationContext } from './OcrNavigation'
import { currentMilkDate } from '../../server/milkDocumentDate.js'
import { useCanOperate } from './useCanOperate'

export function useMilkRecordAccess() {
  const canOperate = useCanOperate('milk_reception')
  const isAdmin = useContext(OcrNavigationContext)?.user?.isAdmin === true
  const [today, setToday] = useState(currentMilkDate)
  useEffect(() => {
    const refresh = () => setToday(currentMilkDate())
    const timer = window.setInterval(refresh, 15000)
    window.addEventListener('focus', refresh)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [])
  const canEditDate = (date: string | undefined) => canOperate && (isAdmin || date === currentMilkDate())
  return { isAdmin, canOperate, today, canEditDate, lockedMessage: canOperate ? 'Only administrators can change records outside the current day.' : 'You have view-only access to this menu.' }
}
