import { apiGet } from './client'
import type { ERP_Supplier } from '../types/suppliers'

export function getRomOfflineSuppliers(
  mode: string,
  username: string,
  signal?: AbortSignal,
  token?: string,
): Promise<ERP_Supplier[]> {
  return apiGet<ERP_Supplier[]>(
    'WMS/ERP_RomOfflineSuppliersList',
    { mode, username },
    { signal, token },
  )
}
