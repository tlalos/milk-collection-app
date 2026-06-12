import type { Supplier, SupplierType } from '../types'

export interface ERP_Supplier {
  sup_id: number
  sup_code: string
  sup_name: string
  sup_afm: string
  sup_address: string
  sup_city: string
  sup_type: number
  sup_occupation: string
  sup_phone01: string
  sup_irsdata: string
  sup_relatedsupcode: string
  sup_relatedsupid: number
  sup_relatedsupname: string
  sup_relatedsupaddress: string
  sup_relatedsupcity: string
  sup_relatedsupafm: string
  sup_relatedsupoccupation: string
  sup_relatedsupphone01: string
  sup_relatedsupirsdata: string
  sup_vatsts: string
}

export interface LocalSupplier extends ERP_Supplier {
  syncedAt: string
}

function getSupplierType(supplier: Pick<ERP_Supplier, 'sup_type' | 'sup_vatsts' | 'sup_relatedsupid'>): SupplierType {
  if (supplier.sup_type === 3 || supplier.sup_relatedsupid > 0) {
    return 'Agricultural cooperative farmer'
  }

  if (supplier.sup_type === 2 || supplier.sup_vatsts === '0') {
    return 'VAT-excluded farmer'
  }

  return 'Regular VAT farmer'
}

export function erpSupplierToSupplier(supplier: ERP_Supplier): Supplier {
  return {
    id: String(supplier.sup_id),
    code: supplier.sup_code,
    name: supplier.sup_name,
    type: getSupplierType(supplier),
  }
}
