import { apiGet } from './client'
import type { ERP_OfflineUser } from '../types/offlineUsers'

export function getOfflineUsers(signal?: AbortSignal): Promise<ERP_OfflineUser[]> {
  return apiGet<ERP_OfflineUser[]>('WMS/ERP_GetOfflineUsers', {}, { signal })
}
