export const BANK_PAYER_IBAN: string
export const BANK_EXPORT_MAX_PAYMENTS: number
export const BANK_EXPORT_HEADERS: string[]
type ProducerMilk = { producerCode: string; producer?: string; producerName?: string; milkType: string }
export type BankExportSource = ProducerMilk & {
  id: string; producerName: string; totalLiters: number; finalAmount: number | null; centers?: string[]
  comment: string; connectedProducer: { producerName: string } | null
  paymentProducer: { iban?: string; producerName?: string; producerCode?: string } | null
}
export type BankExportRow = {
  id: string; producerName: string; recipientName: string; iban: string; amount: number | null
  totalLiters: number; milkType: string; comment: string; centers?: string[]; producerCode?: string; recipientCode?: string
}
export function prepareBankExport(month: string, selected: BankExportSource[], allProducers: ProducerMilk[]): BankExportRow[]
export function bankExportIssues(row: BankExportRow): string[]
export function createBankExportWorkbook(rows: BankExportRow[], firstPaymentNumber?: number): Promise<Uint8Array>
export function createBankExportDownload(month: string, rows: BankExportRow[]): Promise<{ filename: string; mimeType: string; data: Uint8Array }>
