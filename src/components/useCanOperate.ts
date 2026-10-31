import { useContext } from 'react'
import { userCanOperate } from '../../server/accessLevels.js'
import { OcrNavigationContext } from './OcrNavigation'

export function useCanOperate(permission: string) {
  return userCanOperate(useContext(OcrNavigationContext)?.user, permission)
}
