import { login } from '../api/authApi'
import { ApiError } from '../api/client'
import { saveZGParalavesSuppliesOrder } from '../api/suppliesOrderApi'
import { db } from '../db/database'
import { settingsStore } from './settingsStore'
import type { UserSettings } from '../types/auth'
import type { LocalItem } from '../types/items'
import type { LocalSupplier } from '../types/suppliers'
import type { ERP_SuppliesPickingOrder } from '../types/suppliesOrder'
import type { LocalZgParam } from '../types/zgParam'

export type DailyMilkTypeCode = 'MILK-COW' | 'MILK-SHEEP' | 'MILK-GOAT' | 'MILK-BUFF'

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
  rowNumber: number
  aviz?: string | null
  center?: string | null
  status: 'ready' | 'sent' | 'failed'
  message?: string
  newid?: string
}

export interface DailyRouteErpExport {
  status: 'not_ready' | 'sending' | 'sent' | 'failed' | 'partial'
  startedAt?: string
  completedAt?: string
  error?: string | null
  rowCount?: number
  successCount?: number
  failedCount?: number
  rowLog?: DailyRouteErpRowLog[]
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

function readNumberSetting(settings: UserSettings | null, keys: string[], fallback = 0): number {
  return toNumber(readSetting(settings, keys, fallback), fallback)
}

function readStringSetting(settings: UserSettings | null, keys: string[], fallback = ''): string {
  return String(readSetting(settings, keys, fallback))
}

function preferParam(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? ''
  return trimmed || fallback
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s_.-]+/g, '')
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
    !hasValue(row.fatPercent) ? 'fat' : '',
    !hasValue(row.temperature) ? 'temperature' : '',
    !hasValue(row.noticeNumber) ? 'aviz number' : '',
  ].filter(Boolean)
}

function milkAliases(milkType: DailyMilkTypeCode): string[] {
  if (milkType === 'MILK-COW') return ['milkcow', 'cow', 'cowmilk', 'vaca', 'laptedevaca', 'mf0010']
  if (milkType === 'MILK-SHEEP') return ['milksheep', 'sheep', 'sheepmilk', 'oaie', 'laptedeoaie']
  if (milkType === 'MILK-GOAT') return ['milkgoat', 'goat', 'goatmilk', 'capra', 'laptedecapra']
  return ['milkbuff', 'buff', 'buffalo', 'buffalomilk', 'bivol', 'laptedebivol']
}

function findDailyRouteMilkItem(items: LocalItem[], milkType: DailyMilkTypeCode): LocalItem | undefined {
  const milkItems = items.filter((item) => normalize(item.item_offline_type) === 'milkcollection')
  const candidates = milkItems.length ? milkItems : items
  const wanted = milkAliases(milkType)

  return candidates.find((item) => normalize(item.item_utbl04) === normalize(milkType))
    ?? candidates.find((item) => wanted.includes(normalize(item.item_utbl04)))
    ?? candidates.find((item) => wanted.includes(normalize(item.item_code)))
    ?? candidates.find((item) => wanted.some((alias) => normalize(item.item_descr).includes(alias)))
    ?? (milkType === 'MILK-COW' ? candidates.find((item) => normalize(item.item_code) === 'mf0010') ?? candidates[0] : undefined)
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

function matchSupplier(row: DailyRouteExtractedRow, centerMatches: DailyRouteCenterMatch[], suppliers: LocalSupplier[]): LocalSupplier | undefined {
  const center = resolveCenter(row, centerMatches)
  if (center.code) {
    const byCode = suppliers.find((supplier) => normalize(supplier.sup_code) === normalize(center.code))
    if (byCode) return byCode
  }
  if (center.name) {
    const byName = suppliers.find((supplier) => normalize(supplier.sup_name) === normalize(center.name))
    if (byName) return byName
  }
  if (row.collectionCenter) {
    return suppliers.find((supplier) => normalize(supplier.sup_name) === normalize(row.collectionCenter))
  }
  return undefined
}

function toDateKey(value: string | null): string {
  const date = value?.slice(0, 10)
  return date && /^\d{4}-\d{2}-\d{2}$/u.test(date) ? date : new Date().toISOString().slice(0, 10)
}

function createInternalNumber(data: DailyRouteExtractedData, row: DailyRouteExtractedRow, sourceFile: string): string {
  const datePart = toDateKey(data.date).replace(/\D/gu, '').slice(2)
  const routePart = normalize(data.route || sourceFile).replace(/\D/gu, '').slice(-2).padStart(2, '0')
  const avizPart = String(row.noticeNumber || row.rowNumber).replace(/\D/gu, '').slice(-5).padStart(5, '0')
  const rowPart = String(row.rowNumber).replace(/\D/gu, '').slice(-2).padStart(2, '0')
  return `${datePart}${routePart}${avizPart}${rowPart}`.slice(-9)
}

function normalizedMilkType(value: DailyMilkTypeCode | null | undefined): DailyMilkTypeCode {
  return value || 'MILK-COW'
}

function buildPayloadLine(
  data: DailyRouteExtractedData,
  row: DailyRouteExtractedRow,
  sourceFile: string,
  item: LocalItem,
  supplier: LocalSupplier,
  username: string,
  userSettings: UserSettings | null,
  zgParam: LocalZgParam | undefined,
): ERP_SuppliesPickingOrder {
  const salespickingseries = toNumber(
    zgParam?.par_supplies_series1,
    readNumberSetting(userSettings, ['salespickingseries', 'salesPickingSeries', 'sales_picking_series']),
  )
  const frombranch = preferParam(zgParam?.par_from_branch, readStringSetting(userSettings, ['frombranch', 'fromBranch']))
  const fromstore = preferParam(zgParam?.par_from_store, readStringSetting(userSettings, ['fromstore', 'fromStore', 'fromwhouse']))
  const fromposition = readStringSetting(userSettings, ['fromposition', 'fromPosition'])
  const tobranch = preferParam(zgParam?.par_to_branch, readStringSetting(userSettings, ['tobranch', 'toBranch']))
  const tostore = preferParam(zgParam?.par_to_store, readStringSetting(userSettings, ['tostore', 'toStore', 'towhouse']))
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
    comments: `${data.route || ''} ${row.collectionCenter || ''}`.trim(),
    sampleid: notice,
    countryid: readStringSetting(userSettings, ['countryid', 'countryId']),
    compartmentid: '',
    buyerid: readStringSetting(userSettings, ['buyerid', 'buyerId']),
    internalnum: createInternalNumber(data, row, sourceFile),
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
  }
}

export async function sendDailyRouteDetailsToErp(
  data: DailyRouteExtractedData,
  centerMatches: DailyRouteCenterMatch[],
  sourceFile: string,
  signal?: AbortSignal,
  onProgress?: (exportState: DailyRouteErpExport) => void,
): Promise<DailyRouteErpExport> {
  const startedAt = new Date().toISOString()
  const { apiUsername, apiPassword, defaultFiscalYear } = settingsStore.get()
  if (!apiUsername || !apiPassword) throw new Error('API credentials not configured. Open Settings first.')

  const rows = data.rows.filter((row) => hasValue(row.collectionCenter) || hasValue(row.liters) || hasValue(row.fatPercent) || hasValue(row.temperature) || hasValue(row.noticeNumber))
  if (!rows.length) throw new Error('There are no daily route rows with center and liters to send.')

  const incompleteRows = rows
    .map((row) => ({ rowNumber: row.rowNumber, fields: missingErpFields(row) }))
    .filter((row) => row.fields.length > 0)
  if (incompleteRows.length) {
    const details = incompleteRows.map((row) => `row ${row.rowNumber}: ${row.fields.join(', ')}`).join('; ')
    throw new Error(`Cannot send daily route rows to ERP. Missing required fields: ${details}.`)
  }

  const [items, suppliers, zgParam] = await Promise.all([
    db.items.toArray(),
    db.suppliers.toArray(),
    db.zgParams.get('current'),
  ])
  if (!suppliers.length) throw new Error('No synced ERP suppliers were found. Sync local suppliers before sending to ERP.')

  const loginResponse = await login(
    { Username: apiUsername, Password: apiPassword, fiscalyear: defaultFiscalYear },
    signal,
  ).catch((error) => {
    throw new Error(`ERP login failed: ${readableApiError(error)}. Check the Settings API base URL and ERP credentials.`)
  })

  const username = loginResponse.user_name || apiUsername
  const userSettings = loginResponse.user_settings
  const rowLog: DailyRouteErpRowLog[] = rows.map((row) => ({
    rowNumber: row.rowNumber,
    aviz: row.noticeNumber,
    center: resolveCenter(row, centerMatches).name,
    status: 'ready',
  }))

  onProgress?.({ status: 'sending', startedAt, rowCount: rows.length, rowLog })

  for (const row of rows) {
    const logIndex = rowLog.findIndex((entry) => entry.rowNumber === row.rowNumber)
    try {
      const supplier = matchSupplier(row, centerMatches, suppliers)
      if (!supplier) throw new Error(`No synced supplier matched center "${row.collectionCenter || ''}".`)
      const item = findDailyRouteMilkItem(items, normalizedMilkType(row.milkType))
      if (!item) throw new Error(`No synced ERP item matched milk type "${normalizedMilkType(row.milkType)}".`)
      const payload = buildPayloadLine(data, row, sourceFile, item, supplier, username, userSettings, zgParam)
      const response = await saveZGParalavesSuppliesOrder([payload], signal, loginResponse.access_token)
        .catch((error) => {
          throw new Error(`ERP save failed for row ${row.rowNumber}, aviz ${row.noticeNumber || '-'}: ${readableApiError(error)}`)
        })
      if (!response.status) throw new Error(response.status_message || 'ERP rejected this aviz.')
      rowLog[logIndex] = {
        ...rowLog[logIndex],
        status: 'sent',
        message: response.status_message || 'Sent to ERP.',
        newid: response.newid,
      }
    } catch (error) {
      rowLog[logIndex] = {
        ...rowLog[logIndex],
        status: 'failed',
        message: error instanceof Error ? error.message : 'Could not send this aviz to ERP.',
      }
    }
    onProgress?.({ status: 'sending', startedAt, rowCount: rows.length, rowLog: [...rowLog] })
  }

  const successCount = rowLog.filter((row) => row.status === 'sent').length
  const failedCount = rowLog.filter((row) => row.status === 'failed').length
  const status = failedCount === 0 ? 'sent' : successCount === 0 ? 'failed' : 'partial'
  const error = failedCount > 0 ? `${failedCount} ERP row${failedCount === 1 ? '' : 's'} failed.` : null

  return {
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    error,
    rowCount: rows.length,
    successCount,
    failedCount,
    rowLog,
  }
}
