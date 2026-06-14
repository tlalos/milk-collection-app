import type { MilkType } from '../types'

export interface JournalEntry {
  id?: number
  collectionId: string
  collectionDate: string
  submittedAt: string
  supplierId: string
  supplierCode: string
  supplierName: string
  milkType: MilkType
  kg: number
}
