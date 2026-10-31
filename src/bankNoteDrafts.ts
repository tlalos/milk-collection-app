export interface BankNoteDraft {
  connectedAccount?: string
  comment?: string
  status?: 'pending' | 'sent'
  exportedAmount?: number
  exportedLiters?: number
  exportedAt?: string
}
export type BankNoteDrafts = Record<string, BankNoteDraft>
export const bankNoteStorageKey = 'milk-collection-bank-note-v1'
const fieldPrefix = 'milk-collection-bank-note-field-v2:'
type DraftField = 'comment' | 'connectedAccount'
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const invalid = () => new Error('Saved bank-note data could not be read. Do not clear browser data; check the original bank files before exporting again.')

export function isBankNoteStorageKey(key: string | null) {
  return key === null || key === bankNoteStorageKey || key.startsWith(fieldPrefix)
}

export function loadBankNoteDrafts(storage: Storage, month: string): BankNoteDrafts {
  if (!month) return {}
  const stored: unknown = JSON.parse(storage.getItem(bankNoteStorageKey) || '{}')
  if (!object(stored) || (stored[month] !== undefined && !object(stored[month]))) throw invalid()
  const drafts: BankNoteDrafts = Object.create(null)
  for (const [id, value] of Object.entries(stored[month] || {})) {
    if (!object(value)) throw invalid()
    for (const field of ['comment', 'connectedAccount', 'exportedAt']) if (value[field] !== undefined && typeof value[field] !== 'string') throw invalid()
    if (value.status !== undefined && value.status !== 'sent' && value.status !== 'pending') throw invalid()
    for (const field of ['exportedAmount', 'exportedLiters']) if (value[field] !== undefined && (typeof value[field] !== 'number' || !Number.isFinite(value[field]))) throw invalid()
    drafts[id] = { ...value } as BankNoteDraft
  }
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(fieldPrefix)) continue
    const parts: unknown = JSON.parse(key.slice(fieldPrefix.length))
    if (!Array.isArray(parts) || parts.length !== 3) throw invalid()
    const [savedMonth, id, field] = parts
    if (savedMonth !== month) continue
    if (typeof id !== 'string' || (field !== 'comment' && field !== 'connectedAccount')) throw invalid()
    const value = storage.getItem(key)
    if (value !== null) drafts[id] = { ...drafts[id], [field]: value }
  }
  return drafts
}

// Each edit writes one field only. Export evidence in the old month blob is never rewritten.
export function saveBankNoteField(storage: Storage, month: string, id: string, field: DraftField, value: string) {
  loadBankNoteDrafts(storage, month)
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !id || !['comment', 'connectedAccount'].includes(field)) throw invalid()
  storage.setItem(`${fieldPrefix}${JSON.stringify([month, id, field])}`, value)
  return loadBankNoteDrafts(storage, month)
}

export function resolveBankNoteDraft(drafts: BankNoteDrafts, rowId: string, producerCode: string, multipleRows: boolean) {
  const legacy = !multipleRows ? drafts[producerCode.trim().toLocaleLowerCase()] : undefined
  const row = drafts[rowId]
  // A comment-only row must not hide an older producer-level exported marker.
  return { ...legacy, ...row, ...(legacy?.status === 'sent' && row?.status !== 'sent' ? {
    status: legacy.status, exportedAmount: legacy.exportedAmount, exportedLiters: legacy.exportedLiters, exportedAt: legacy.exportedAt,
  } : {}) }
}
