import { apiGet } from './client'
import type { ERP_Customer } from '../types/customers'

// GET api/WMS/ERP_CustomersList?search={search}   [Authorize]
export function getCustomers(search: string, signal?: AbortSignal): Promise<ERP_Customer[]> {
  return apiGet<ERP_Customer[]>('WMS/ERP_CustomersList', { search }, { signal })
}
