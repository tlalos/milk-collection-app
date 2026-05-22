export type SupplierType =
  | 'Regular VAT farmer'
  | 'VAT-excluded farmer'
  | 'Agricultural cooperative farmer'

export type MilkType = 'Goat milk' | 'Sheep milk' | 'Cow milk'

export interface Supplier {
  id: string
  name: string
  code: string
  type: SupplierType
}

export interface MilkEntry {
  id: string
  milkType: MilkType | ''
  kg: string
  barcode: string
}

export interface SubmittedCollection {
  supplier: Supplier
  entries: MilkEntry[]
  submittedAt: string
}
