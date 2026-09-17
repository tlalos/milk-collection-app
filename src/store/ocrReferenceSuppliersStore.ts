import { appPath } from '../ocrPaths'
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

  pendingLoad = fetch(appPath('/api/ocr/reference-suppliers'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ocrConnectionSettings: ocrConnectionSettingsStore.get() }),
  })
    .then(async (response) => {
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
    })
    .finally(() => {
      pendingLoad = null
    })

  return pendingLoad
}
