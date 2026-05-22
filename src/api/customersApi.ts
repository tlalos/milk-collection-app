import { apiGet } from './client'
import type { FS_Customer } from '../types/customers'

// GET api/FS/FS_GetCustomers?search={search}   [Authorize]
export function getCustomers(search: string, signal?: AbortSignal): Promise<FS_Customer[]> {
  return apiGet<FS_Customer[]>('FS/FS_GetCustomers', { search }, { signal })
}
