import { appPath } from './ocrPaths'
import type { BankExportRow } from './bankNoteExport'

export type BankExportBatch = {
  batchId: string; month: string; exportNumber: number; createdAt: string; createdBy: string
  status: 'EXPORTED' | 'CANCELLED'; paymentCount: number; totalAmount: number; totalLiters: number
  currency: string; filename: string; sha256: string; cancelledAt: string | null; cancelledBy: string | null; cancelReason: string | null
  lines?: (BankExportRow & { lineNumber: number })[]
}
export type BankExportPayment = { id: string; batchId: string; exportNumber: number; createdAt: string; amount: number; totalLiters: number }
export type BankExportHistory = { batches: BankExportBatch[]; payments: BankExportPayment[] }
export function newBankExportRequestKey() {
  // getRandomValues is also available on the HTTP intranet deployment.
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
}
export async function bankExportRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(appPath(`/api/bank-exports${path}`), options)
  const payload = await response.json()
  if (!response.ok) throw new Error(payload.error || 'Could not load bank export history.')
  return payload as T
}
export async function downloadSavedBankExport(batch: BankExportBatch) {
  const response = await fetch(appPath(`/api/bank-exports/${batch.batchId}/file`))
  if (!response.ok) throw new Error('Export is saved, but the download failed. Download it again from Export history.')
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url; link.download = batch.filename
  document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
