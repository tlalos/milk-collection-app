import { apiGet } from './client'
import type { ERP_Truck } from '../types/trucks'

export function getRomOfflineSupplierVehicles(
  mode: string,
  username: string,
  signal?: AbortSignal,
  token?: string,
): Promise<ERP_Truck[]> {
  return apiGet<ERP_Truck[]>(
    'WMS/ERP_RomOfflineSuppliersVehiclesList',
    { mode, username },
    { signal, token },
  )
}
