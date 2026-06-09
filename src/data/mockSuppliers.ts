import type { MilkType, Supplier } from '../types'

export const milkTypes: MilkType[] = ['Cow milk', 'Sheep milk', 'Buffalo milk', 'Goat milk']

export const mockSuppliers: Supplier[] = [
  {
    id: 'supplier-001',
    name: 'Dimitris Papadopoulos',
    code: 'SUP-001',
    type: 'Regular VAT farmer',
  },
  {
    id: 'supplier-002',
    name: 'Giannis Farm',
    code: 'SUP-002',
    type: 'VAT-excluded farmer',
  },
  {
    id: 'supplier-003',
    name: 'Cooperative of Larisa',
    code: 'COOP-014',
    type: 'Agricultural cooperative farmer',
  },
  {
    id: 'supplier-004',
    name: 'Nikos Livestock',
    code: 'SUP-018',
    type: 'Regular VAT farmer',
  },
  {
    id: 'supplier-005',
    name: 'Thessaly Dairy Group',
    code: 'COOP-021',
    type: 'Agricultural cooperative farmer',
  },
  {
    id: 'supplier-006',
    name: 'Maria Goat Farm',
    code: 'SUP-027',
    type: 'VAT-excluded farmer',
  },
]
