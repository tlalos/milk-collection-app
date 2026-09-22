import { appPath } from '../ocrPaths'
import { fetchErpSupplierList, loginToErp } from '../api/client'
import { ocrConnectionSettingsStore } from './ocrConnectionSettingsStore'

export interface OcrReferenceCenter {
  code: string
  name: string
}

export interface OcrReferenceProducer {
  producerCode: string
  producerName: string
  centerCode?: string
  centerName?: string
  trn?: string
  primaryAddress?: string
  zip?: string
  city?: string
  primaryPhone?: string
  exploitationCode?: string
  active?: string
  vatStatusName?: string
  bankCode?: string
  iban?: string
  extra?: string
  bool2?: string
}

export interface OcrReferenceSuppliers {
  centers: OcrReferenceCenter[]
  producers: OcrReferenceProducer[]
  fetchedAt: string
  source?: string
}

interface ReferenceSuppliersPayload {
  centers?: OcrReferenceCenter[]
  producers?: OcrReferenceProducer[]
  fetchedAt?: string
  source?: string
  error?: string
}

let cachedReferences: OcrReferenceSuppliers | null = null
let pendingLoad: Promise<OcrReferenceSuppliers> | null = null
const CACHE_KEY = 'ocr_reference_suppliers_cache'

function valueFrom(source: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  const normalizedEntries = Object.entries(source).map(([key, value]) => [
    key.toLowerCase().replace(/[^a-z0-9]/gu, ''),
    value,
  ] as const)
  for (const key of keys) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '')
    const value = normalizedEntries.find(([entryKey]) => entryKey === normalizedKey)?.[1]
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function flagFrom(source: Record<string, unknown>, ...keys: string[]) {
  const value = valueFrom(source, ...keys)
  const normalized = value.toLowerCase()
  if (['1', 'true', 'yes'].includes(normalized)) return '1'
  if (['0', 'false', 'no'].includes(normalized)) return '0'
  return value
}

function vatStatusNameFrom(supplier: Record<string, unknown>) {
  const name = valueFrom(
    supplier,
    'sup_vatstatus_name',
    'sup_vatstatusname',
    'supVatStatusName',
    'supVatstatusName',
    'vat status',
    'vat_status',
    'vatStatusName',
  )
  if (name) return name
  const code = valueFrom(supplier, 'sup_vatsts', 'supVatsts', 'vatsts', 'vat_status_code', 'vatStatus')
  if (code === '0') return 'is exempted'
  if (code === '1') return 'regular'
  if (code === '2') return 'reduced'
  return ''
}

function mapErpSuppliers(suppliers: Record<string, unknown>[]) {
  const codeFrom = (supplier: Record<string, unknown>) => valueFrom(supplier, 'sup_code', 'Producer_Code', 'producer_code', 'code')
  const nameFrom = (supplier: Record<string, unknown>) => valueFrom(supplier, 'sup_name', 'Producer_Name', 'producer_name', 'name')
  const seenCenters = new Set<string>()
  const centers = suppliers
    .filter((supplier) => codeFrom(supplier).toLowerCase().startsWith('c'))
    .map((supplier) => ({ code: codeFrom(supplier), name: nameFrom(supplier) }))
    .filter((center) => {
      const code = center.code.toLowerCase()
      if (!code || !center.name || seenCenters.has(code)) return false
      seenCenters.add(code)
      return true
    })
  const producers = suppliers
    .filter((supplier) => codeFrom(supplier).toLowerCase().startsWith('p'))
    .map((supplier) => ({
      producerCode: codeFrom(supplier),
      producerName: nameFrom(supplier),
      centerCode: valueFrom(supplier, 'sup_central_code', 'Center_Code', 'center_code', 'sup_relatedsupcode'),
      centerName: valueFrom(supplier, 'sup_central_name', 'Center_Name', 'center_name', 'sup_relatedsupname'),
      trn: valueFrom(supplier, 'sup_afm', 'sup_irsdata', 'TRN', 'trn'),
      primaryAddress: valueFrom(supplier, 'sup_address', 'Primary_Address', 'primary_address', 'address'),
      zip: valueFrom(supplier, 'sup_zip', 'Zip', 'zip'),
      city: valueFrom(supplier, 'sup_district', 'City', 'city', 'sup_city'),
      primaryPhone: valueFrom(supplier, 'sup_phone01', 'Primary_Phone', 'primary_phone', 'phone'),
      exploitationCode: valueFrom(supplier, 'sup_elogak', 'Cod Exploatatie', 'cod_exploatatie', 'exploitation_code'),
      active: valueFrom(supplier, 'sup_isactive', 'Active', 'active'),
      vatStatusName: vatStatusNameFrom(supplier),
      bankCode: valueFrom(supplier, 'sup_bankcode', 'bank code', 'bank_code', 'bankCode'),
      iban: valueFrom(supplier, 'sup_iban', 'iban', 'IBAN'),
      extra: flagFrom(supplier, 'sup_bool01', 'sup_bool1', 'supBool01', 'supBool1', 'extra'),
      bool2: flagFrom(supplier, 'sup_bool02', 'sup_bool2', 'supBool02', 'supBool2', 'bool2'),
    }))
    .filter((producer) => producer.producerCode && producer.producerName)
  return { centers, producers }
}

export function getCachedOcrReferenceSuppliers() {
  if (cachedReferences) return cachedReferences
  try {
    const raw = sessionStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OcrReferenceSuppliers
    if (!Array.isArray(parsed.centers) || !Array.isArray(parsed.producers) || !parsed.fetchedAt) return null
    cachedReferences = parsed
  } catch {
    cachedReferences = null
  }
  return cachedReferences
}

export async function loadOcrReferenceSuppliers(options: { force?: boolean } = {}) {
  if (cachedReferences && !options.force) return cachedReferences
  if (pendingLoad && !options.force) return pendingLoad

  pendingLoad = (async () => {
    const settings = ocrConnectionSettingsStore.get()
    const login = await loginToErp(settings)
    const suppliers = await fetchErpSupplierList(settings, login.access_token)
    const mapped = mapErpSuppliers(suppliers)
    const response = await fetch(appPath('/api/ocr/reference-suppliers'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referenceCenters: mapped.centers, referenceProducers: mapped.producers }),
    })
      const payload = await response.json() as ReferenceSuppliersPayload
      if (!response.ok) throw new Error(payload.error || 'Could not load ERP suppliers.')

      const references: OcrReferenceSuppliers = {
        centers: (payload.centers || []).filter((center) => center?.code && center?.name),
        producers: (payload.producers || []).filter((producer) => producer?.producerCode && producer?.producerName),
        fetchedAt: payload.fetchedAt || new Date().toISOString(),
        source: payload.source,
      }
      cachedReferences = references
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify(references))
      } catch {
        // The in-memory copy is enough when browser storage is unavailable.
      }
      return references
    })()
    .finally(() => {
      pendingLoad = null
    })

  return pendingLoad
}
