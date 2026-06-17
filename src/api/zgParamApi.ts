import { apiGet } from './client'
import type { ERP_ZgParam } from '../types/zgParam'

export function getRomZgParam(
  username: string,
  signal?: AbortSignal,
  token?: string,
): Promise<ERP_ZgParam[]> {
  return apiGet<ERP_ZgParam[]>(
    'WMS/ERP_RomZgParam',
    { username },
    { signal, token },
  )
}
