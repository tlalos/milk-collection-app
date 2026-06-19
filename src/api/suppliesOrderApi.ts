import { apiPost } from './client'
import type { ERP_RetFunc, ERP_SuppliesPickingOrder } from '../types/suppliesOrder'

export function saveZGParalavesSuppliesOrder(
  order: ERP_SuppliesPickingOrder[],
  signal?: AbortSignal,
  token?: string,
): Promise<ERP_RetFunc> {
  return apiPost<ERP_SuppliesPickingOrder[], ERP_RetFunc>(
    'WMS/ERP_SaveRomZGParalavesSuppliesOrder',
    order,
    { signal, token },
  )
}
