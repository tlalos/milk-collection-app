import { db } from '../db/database'
import type { MilkEntry, MilkType, SubmittedCollection } from '../types'
import type { JournalEntry, JournalErpStatus } from '../types/journal'

interface CompletedMilkEntry extends MilkEntry {
  milkType: MilkType
}

export function toLocalDateKey(value: Date | string = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function saveCollectionToJournal(collection: SubmittedCollection): Promise<number> {
  const collectionId = globalThis.crypto?.randomUUID?.() ?? `collection-${Date.now()}`
  const collectionDate = toLocalDateKey(collection.submittedAt)
  const journalEntries: JournalEntry[] = collection.entries
    .filter((entry): entry is CompletedMilkEntry => Boolean(entry.milkType) && Number(entry.kg) > 0)
    .map((entry) => ({
      collectionId,
      collectionDate,
      submittedAt: collection.submittedAt,
      supplierId: collection.supplier.id,
      supplierCode: collection.supplier.code,
      supplierName: collection.supplier.name,
      milkType: entry.milkType,
      kg: Number(entry.kg),
      barcode: entry.barcode,
      waterPercentage: entry.waterPercentage,
      temperature: entry.temperature,
      mobility: entry.mobility,
      erpStatus: 'pending',
      erpMessage: '',
      erpNewId: '',
      erpSyncedAt: null,
    }))

  if (journalEntries.length === 0) {
    return 0
  }

  await db.journalEntries.bulkAdd(journalEntries)
  return journalEntries.length
}

export async function getJournalEntriesByDate(date: string): Promise<JournalEntry[]> {
  const records = await db.journalEntries
    .where('collectionDate')
    .equals(date)
    .toArray()

  return records.sort((a, b) =>
    new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  )
}

export async function getJournalEntriesByCollection(collectionId: string): Promise<JournalEntry[]> {
  return db.journalEntries
    .where('collectionId')
    .equals(collectionId)
    .toArray()
}

export function journalEntriesToCollection(entries: JournalEntry[]): SubmittedCollection {
  const first = entries[0]

  if (!first) {
    throw new Error('Supply order is empty.')
  }

  return {
    supplier: {
      id: first.supplierId,
      code: first.supplierCode,
      name: first.supplierName,
      type: 'Regular VAT farmer',
    },
    submittedAt: first.submittedAt,
    entries: entries.map((entry) => ({
      id: String(entry.id ?? `${entry.collectionId}-${entry.milkType}`),
      milkType: entry.milkType,
      kg: String(entry.kg),
      barcode: entry.barcode ?? '',
      waterPercentage: entry.waterPercentage ?? '',
      temperature: entry.temperature ?? '',
      mobility: entry.mobility ?? '',
    })),
  }
}

export async function updateJournalCollectionErpStatus(
  collectionId: string,
  erpStatus: JournalErpStatus,
  erpMessage: string,
  erpNewId = '',
): Promise<void> {
  const rows = await getJournalEntriesByCollection(collectionId)
  const erpSyncedAt = erpStatus === 'sent' ? new Date().toISOString() : null

  await db.transaction('rw', db.journalEntries, async () => {
    await Promise.all(
      rows
        .filter((row): row is JournalEntry & { id: number } => row.id !== undefined)
        .map((row) =>
          db.journalEntries.update(row.id, {
            erpStatus,
            erpMessage,
            erpNewId,
            erpSyncedAt,
          }),
        ),
    )
  })
}
