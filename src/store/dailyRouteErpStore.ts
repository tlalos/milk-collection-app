import { loginToErp } from '../api/client'
import { ApiError } from '../api/client'
import { getRomOfflineItems } from '../api/itemsApi'
import { getRomOfflineSuppliers } from '../api/suppliersApi'
import { saveZGParalavesSuppliesOrder } from '../api/suppliesOrderApi'
import { getRomZgParam } from '../api/zgParamApi'
import { ocrConnectionSettingsStore } from './ocrConnectionSettingsStore'
import type { UserSettings } from '../types/auth'
import type { ERP_Item } from '../types/items'
import type { ERP_Supplier } from '../types/suppliers'
import type { ERP_SuppliesPickingOrder } from '../types/suppliesOrder'
import type { ERP_ZgParam } from '../types/zgParam'

export type DailyMilkTypeCode = 'MILK-COW' | 'MILK-SHEEP' | 'MILK-GOAT' | 'MILK-BUFF'

type DailyRouteMilkItem = Pick<ERP_Item, 'item_id' | 'item_code'>

const DAILY_ROUTE_MILK_ITEMS: Partial<Record<DailyMilkTypeCode, DailyRouteMilkItem>> = {
  'MILK-COW': { item_id: 16551, item_code: 'MF0010' },
  'MILK-SHEEP': { item_id: 17119, item_code: 'mff0000000000038' },
  'MILK-BUFF': { item_id: 17155, item_code: 'mff0000000000042' },
}

export interface DailyRouteExtractedRow {
  rowNumber: number
  collectionCenter: string | null
  milkType?: DailyMilkTypeCode | null
  liters: number | null
  fatPercent: number | null
  density: number | null
  water: number | null
  temperature: number | null
  noticeNumber: string | null
  sampleId?: string | null
}

export interface DailyRouteExtractedData {
  date: string | null
  driverName: string | null
  vehicleRegistration: string | null
  route: string | null
  rows: DailyRouteExtractedRow[]
}

export interface DailyRouteCenterMatch {
  rowNumber: number
  selectedCode: string | null
  selectedName: string | null
  suggestions: Array<{ code: string; name: string; score: number }>
}

export interface DailyRouteErpRowLog {
  neverAttempted?: boolean
  rowNumber: number
  aviz?: string | null
  center?: string | null
  status: 'ready' | 'sent' | 'failed'
  message?: string
  newid?: string
  documents?: Array<{
    kind: 'aviz' | 'nir'
    status: 'ready' | 'sending' | 'sent' | 'failed' | 'unconfirmed'
    message?: string
    newid?: string
    completedAt?: string
    manualVerification?: { outcome: 'found' | 'absent'; erpId?: string; checkedAt: string }
    attempts?: unknown[]
  }>
}

export interface DailyRouteErpExport {
  initialRowNumber?: number
  recoveryId?: string
  recoveryRowNumber?: number
  status: 'not_ready' | 'sending' | 'sent' | 'failed' | 'partial'
  startedAt?: string
  completedAt?: string
  error?: string | null
  rowCount?: number
  successCount?: number
  failedCount?: number
  rowLog?: DailyRouteErpRowLog[]
}

export function failedDailyErpRecovery(state: DailyRouteErpExport, message: string): DailyRouteErpExport {
  const result = structuredClone(state)
  for (const row of result.rowLog ?? []) {
    for (const doc of row.documents ?? []) {
      if (doc.status === 'sending') {
        doc.status = 'unconfirmed'
        doc.message = `Check ERP before retrying: ${message}`
      }
    }
    if (row.rowNumber === result.recoveryRowNumber && row.status !== 'sent') {
      row.status = 'failed'
      row.message = message
    }
  }
  result.successCount = result.rowLog?.filter(row => row.status === 'sent').length ?? 0
  result.rowCount = result.rowLog?.length ?? 0
  result.failedCount = result.rowCount - result.successCount
  const uncertainOrSent = result.rowLog?.some(row => row.status === 'sent' || row.documents?.some(doc => doc.status === 'sent' || doc.status === 'unconfirmed'))
  result.status = result.failedCount === 0 && result.rowCount > 0 ? 'sent' : uncertainOrSent ? 'partial' : 'failed'
  result.error = message
  result.completedAt = new Date().toISOString()
  return result
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readSetting(settings: UserSettings | null, keys: string[], fallback: unknown = ''): unknown {
  if (!settings) return fallback
  for (const key of keys) {
    if (settings[key] !== undefined && settings[key] !== null && settings[key] !== '') return settings[key]
  }
  return fallback
}

function readStringSetting(settings: UserSettings | null, keys: string[], fallback = ''): string {
  return String(readSetting(settings, keys, fallback))
}

function preferParam(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? ''
  return trimmed || fallback
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function hasValue(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== ''
}

function readableApiError(error: unknown): string {
  if (error instanceof ApiError) return `${error.message} (${error.status})`
  return error instanceof Error ? error.message : 'Unexpected API error.'
}

function missingErpFields(row: DailyRouteExtractedRow): string[] {
  return [
    !hasValue(row.collectionCenter) ? 'center' : '',
    !hasValue(row.liters) ? 'liters' : '',
    !hasValue(row.noticeNumber) ? 'aviz number' : '',
  ].filter(Boolean)
}

function milkAliases(milkType: DailyMilkTypeCode): string[] {
  if (milkType === 'MILK-COW') return ['cowmilk', 'milkcow', 'cow']
  if (milkType === 'MILK-SHEEP') return ['sheepmilk', 'milksheep', 'sheep']
  if (milkType === 'MILK-GOAT') return ['goatmilk', 'milkgoat', 'goat']
  return ['milkbuff']
}

function findDailyRouteMilkItem(items: ERP_Item[], milkType: DailyMilkTypeCode): DailyRouteMilkItem | undefined {
  const fixedItem = DAILY_ROUTE_MILK_ITEMS[milkType]
  if (fixedItem) return fixedItem
  const candidates = items.filter((item) => ['milkcollection', 'supplies'].includes(normalize(item.item_offline_type)))
  const wanted = milkAliases(milkType)

  return candidates.find((item) => wanted.includes(normalize(item.item_utbl04)))
    ?? candidates.find((item) => wanted.includes(normalize(item.item_descr)))
    ?? candidates.find((item) => wanted.some((alias) => normalize(item.item_descr).includes(alias)))
    ?? candidates.find((item) => wanted.includes(normalize(item.item_code)))
    ?? items.find((item) => wanted.includes(normalize(item.item_descr)))
    ?? items.find((item) => wanted.some((alias) => normalize(item.item_descr).includes(alias)))
    ?? items.find((item) => wanted.includes(normalize(item.item_code)))
}

export function dailyCenterSelectionError(rows: DailyRouteExtractedRow[], matches: DailyRouteCenterMatch[]): string | null {
  const name = (value: string | null | undefined) => (value || '').trim().replace(/\s+/gu, ' ').toUpperCase()
  for (const row of rows) {
    const match = matches.find(item => item.rowNumber === row.rowNumber)
    if (!match?.selectedCode) return `Row ${row.rowNumber}: select an ERP center code before sending.`
    // Suggestions are historical OCR matches; matchSupplier validates against live ERP data.
    if (!name(row.collectionCenter) || name(row.collectionCenter) !== name(match.selectedName)) {
      return `Row ${row.rowNumber}: the center name and ERP selection do not agree. Select the correct ERP center again.`
    }
  }
  return null
}

function resolveCenter(row: DailyRouteExtractedRow, centerMatches: DailyRouteCenterMatch[]) {
  const match = centerMatches.find((item) => item.rowNumber === row.rowNumber)
  const selectedCode = match?.selectedCode?.trim() || null
  const selectedName = match?.selectedName?.trim() || null
  const suggestion = selectedCode ? match?.suggestions.find((item) => item.code === selectedCode) : null
  return {
    code: selectedCode,
    name: selectedName || suggestion?.name || row.collectionCenter || null,
  }
}

function matchSupplier(row: DailyRouteExtractedRow, centerMatches: DailyRouteCenterMatch[], suppliers: ERP_Supplier[]): ERP_Supplier {
  const center = resolveCenter(row, centerMatches)
  if (!center.code) throw new Error(`Row ${row.rowNumber}: select an ERP center code before sending.`)
  const supplier = suppliers.find((item) => String(item.sup_code ?? '').trim().toLowerCase() === center.code!.toLowerCase())
  if (!supplier) throw new Error(`Row ${row.rowNumber}: center code "${center.code}" was not found in ERP.`)
  const centerName = (value: string | null | undefined) => (value || '').trim().replace(/\s+/gu, ' ').toUpperCase()
  if (centerName(row.collectionCenter) !== centerName(supplier.sup_name) || centerName(center.name) !== centerName(supplier.sup_name)) {
    throw new Error(`Row ${row.rowNumber}: the center name and ERP selection do not agree. Select the correct ERP center again.`)
  }
  return supplier
}

function toDateKey(value: string | null): string {
  const date = value?.slice(0, 10)
  return date && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : new Date().toISOString().slice(0, 10)
}

function normalizedMilkType(value: DailyMilkTypeCode | null | undefined): DailyMilkTypeCode {
  return value || 'MILK-COW'
}

function buildPayloadLine(
  data: DailyRouteExtractedData,
  row: DailyRouteExtractedRow,
  item: DailyRouteMilkItem,
  supplier: ERP_Supplier,
  username: string,
  userSettings: UserSettings | null,
  zgParam: ERP_ZgParam | undefined,
): ERP_SuppliesPickingOrder {
  const salespickingseries = 5101
  const frombranch = preferParam(zgParam?.par_from_branch, readStringSetting(userSettings, ['frombranch', 'fromBranch']))
  const fromstore = '111'
  const fromposition = readStringSetting(userSettings, ['fromposition', 'fromPosition'])
  const tobranch = preferParam(zgParam?.par_to_branch, readStringSetting(userSettings, ['tobranch', 'toBranch']))
  const tostore = '0'
  const toposition = readStringSetting(userSettings, ['toposition', 'toPosition'])
  const qty1 = toNumber(row.liters)
  const notice = String(row.noticeNumber ?? '').trim()

  return {
    order_id: 0,
    ftr_row_id: 0,
    cus_id: supplier.sup_id,
    username,
    salespickingseries,
    store: fromstore,
    store_id: fromstore,
    position: fromposition,
    position_id: fromposition,
    item_id: item.item_id,
    item_code: item.item_code,
    qty1,
    qty2: qty1,
    price: 0,
    disc1prc: 0,
    disc2prc: 0,
    lot_id: 0,
    lot_lot: '',
    pal_code: '',
    item_extra_field: '',
    item_comments: `${normalizedMilkType(row.milkType)} daily route ${data.route || ''} row ${row.rowNumber}`.trim(),
    frombranch,
    fromstore,
    fromposition,
    tobranch,
    tostore,
    toposition,
    transportnum: data.vehicleRegistration ?? '',
    comments: notice,
    sampleid: String(row.sampleId ?? '').trim(),
    countryid: readStringSetting(userSettings, ['countryid', 'countryId']),
    compartmentid: '',
    buyerid: readStringSetting(userSettings, ['buyerid', 'buyerId']),
    internalnum: notice,
    setdate: toDateKey(data.date),
    origin_supid: supplier.sup_id,
    carrierid: readStringSetting(userSettings, ['carrierid', 'carrierId']),
    shipkindid: readStringSetting(userSettings, ['shipkindid', 'shipKindId']),
    shipmentid: readStringSetting(userSettings, ['shipmentid', 'shipmentId']),
    fat: hasValue(row.fatPercent) ? String(row.fatPercent) : '',
    density: hasValue(row.density) ? String(row.density) : '',
    temperature: hasValue(row.temperature) ? String(row.temperature) : '',
    water: hasValue(row.water) ? String(row.water) : '',
    alcohol: '',
    antibiotic: '',
    silo: '',
    ph: '',
    mobility: '',
    vatid: '',
  }
}

export async function sendDailyRouteDetailsToErp(
  data: DailyRouteExtractedData,
  centerMatches: DailyRouteCenterMatch[],
  signal?: AbortSignal,
  onProgress?: (exportState: DailyRouteErpExport) => void | Promise<void>,
  recovery?: { state: DailyRouteErpExport; rowNumber: number; initial?: boolean },
): Promise<DailyRouteErpExport> {
  const startedAt = new Date().toISOString()
  const settings = await ocrConnectionSettingsStore.resolve()
  if (!settings.serverUrl || !settings.apiUsername || !settings.apiPassword) {
    throw new Error('OCR ERP connection is not configured. Open OCR connection settings and save the API URL, username, and password.')
  }

  const rows = data.rows.filter((row) => (!recovery || row.rowNumber === recovery.rowNumber) && (hasValue(row.collectionCenter) || hasValue(row.liters) || hasValue(row.fatPercent) || hasValue(row.temperature) || hasValue(row.noticeNumber)))
  if (!rows.length) throw new Error('There are no daily route rows with center and liters to send.')

  const incompleteRows = rows
    .map((row) => ({ rowNumber: row.rowNumber, fields: missingErpFields(row) }))
    .filter((row) => row.fields.length > 0)
  if (incompleteRows.length) {
    const details = incompleteRows.map((row) => `row ${row.rowNumber}: ${row.fields.join(', ')}`).join('; ')
    throw new Error(`Cannot send daily route rows to ERP. Missing required fields: ${details}.`)
  }

  const loginResponse = await loginToErp(settings).catch((error) => {
    throw new Error(`ERP login failed: ${readableApiError(error)}. Check the OCR connection settings.`)
  })

  const username = 'zg1'
  const userSettings = loginResponse.user_settings
  const [items, suppliers, zgParams] = await Promise.all([
    getRomOfflineItems('ALL', username, signal, loginResponse.access_token, settings.serverUrl),
    getRomOfflineSuppliers('ALL', username, signal, loginResponse.access_token, settings.serverUrl),
    getRomZgParam(username, signal, loginResponse.access_token, settings.serverUrl),
  ])
  if (!suppliers.length) throw new Error('ERP returned no suppliers for daily routes.')
  const zgParam = zgParams[0]
  const rowLog: DailyRouteErpRowLog[] = recovery ? structuredClone(recovery.state.rowLog ?? []) : rows.map((row) => ({
    rowNumber: row.rowNumber,
    aviz: row.noticeNumber,
    center: resolveCenter(row, centerMatches).name,
    status: 'ready',
    documents: [{ kind: 'aviz', status: 'ready' }, { kind: 'nir', status: 'ready' }],
  }))

  if (recovery) {
    const entry = rowLog.find(row => row.rowNumber === recovery.rowNumber)
    const initial = recovery.initial && recovery.state.initialRowNumber === recovery.rowNumber && Boolean(recovery.state.recoveryId)
    if (!entry?.documents?.length || entry.documents.some(doc => doc.status !== 'sent' && (doc.status !== 'ready' || (!initial && doc.manualVerification?.outcome !== 'absent')))) {
      throw new Error('Manual ERP verification is required before retrying.')
    }
  }
  const persistProgress = () => onProgress?.({ ...recovery?.state, status: 'sending', startedAt, rowCount: rowLog.length, rowLog: structuredClone(rowLog) })
  await persistProgress()

  for (const row of rows) {
    const logIndex = rowLog.findIndex((entry) => entry.rowNumber === row.rowNumber)
    let payload: ERP_SuppliesPickingOrder
    try {
      const supplier = matchSupplier(row, centerMatches, suppliers)
      const item = findDailyRouteMilkItem(items, normalizedMilkType(row.milkType))
      if (!item) throw new Error(`No synced ERP item matched milk type "${normalizedMilkType(row.milkType)}".`)
      payload = buildPayloadLine(data, row, item, supplier, username, userSettings, zgParam)
    } catch (error) {
      rowLog[logIndex] = {
        ...rowLog[logIndex],
        status: 'failed',
        message: error instanceof Error ? error.message : 'Could not send this aviz to ERP.',
      }
      await persistProgress()
      continue
    }
    const entry = rowLog[logIndex]
    for (const document of entry.documents!) {
      if (document.status === 'sent') continue
      if (document.kind === 'nir' && entry.documents!.find(doc => doc.kind === 'aviz')?.status !== 'sent') break
      document.status = 'sending'
      await persistProgress()
      try {
        const order = document.kind === 'nir'
          ? { ...payload, salespickingseries: 2153, tostore: '110' }
          : payload
        const response = await saveZGParalavesSuppliesOrder([order], signal, loginResponse.access_token, settings.serverUrl)
        if (typeof response?.status !== 'boolean') throw new Error('ERP returned no definitive status.')
        document.status = response.status ? 'sent' : 'failed'
        document.message = response.status_message || (response.status ? 'Sent to ERP.' : 'ERP rejected the document.')
        document.newid = response.newid
      } catch (error) {
        document.status = 'unconfirmed'
        document.message = `Check ERP before retrying: ${readableApiError(error)}`
      }
      document.completedAt = new Date().toISOString()
      entry.status = entry.documents!.every((doc) => doc.status === 'sent') ? 'sent' : 'failed'
      entry.message = entry.documents!.map((doc) => `${doc.kind.toUpperCase()}: ${doc.status}${doc.message ? ` - ${doc.message}` : ''}${doc.newid ? ` (ID ${doc.newid})` : ''}`).join(' | ')
      await persistProgress()
      if (document.status !== 'sent') break
    }
    // An unreadable response may still represent a saved ERP document. Stop the batch.
    if (entry.documents!.some((doc) => doc.status === 'unconfirmed')) break
  }

  const successCount = rowLog.filter((row) => row.status === 'sent').length
  const failedCount = rowLog.filter((row) => row.status === 'failed').length
  const pendingCount = rowLog.length - successCount - failedCount
  const hasSentOrUnconfirmed = rowLog.some((row) => row.documents?.some((doc) => ['sent', 'sending', 'unconfirmed'].includes(doc.status)))
  const status = successCount === rowLog.length ? 'sent' : hasSentOrUnconfirmed ? 'partial' : 'failed'
  const error = failedCount > 0 ? `${failedCount} ERP row${failedCount === 1 ? '' : 's'} failed.`
    : pendingCount > 0 ? `${pendingCount} ERP row${pendingCount === 1 ? '' : 's'} not sent yet.` : null

  return {
    ...recovery?.state,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    error,
    rowCount: rowLog.length,
    successCount,
    failedCount,
    rowLog,
  }
}
