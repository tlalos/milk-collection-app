import { db } from '../db/database'
import type { MilkEntry, MilkType, SubmittedCollection } from '../types'
import type { JournalEntry } from '../types/journal'

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
