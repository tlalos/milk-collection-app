export type SupplierType =
  | 'Regular VAT farmer'
  | 'VAT-excluded farmer'
  | 'Agricultural cooperative farmer'

export type MilkType = string

export interface Supplier {
  id: string
  name: string
  code: string
  type: SupplierType
}

export interface MilkEntry {
  id: string
  milkType: MilkType | ''
  itemId?: number
  itemCode?: string
  itemDescription?: string
  kg: string
  waterPercentage: string
  temperature: string
  mobility: string
  barcode: string
}

export interface SubmittedCollection {
  supplier: Supplier
  entries: MilkEntry[]
  submittedAt: string
}
