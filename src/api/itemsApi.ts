import { apiGet } from './client'
import type { ERP_Item } from '../types/items'

export function getRomOfflineItems(
  mode: string,
  username: string,
  signal?: AbortSignal,
  token?: string,
): Promise<ERP_Item[]> {
  return apiGet<ERP_Item[]>(
    'WMS/ERP_RomOfflineItemsList',
    { mode, username },
    { signal, token },
  )
}
