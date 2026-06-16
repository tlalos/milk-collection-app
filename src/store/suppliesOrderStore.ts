import { login } from '../api/authApi'
import { saveZGParalavesSuppliesOrder } from '../api/suppliesOrderApi'
import { db } from '../db/database'
import { settingsStore } from './settingsStore'
import type { SubmittedCollection, MilkEntry, MilkType } from '../types'
import type { AuthUser, UserSettings } from '../types/auth'
import type { LocalItem } from '../types/items'
import type { ERP_RetFunc, ERP_SuppliesPickingOrder } from '../types/suppliesOrder'

interface CompletedMilkEntry extends MilkEntry {
  milkType: MilkType
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function readSetting(settings: UserSettings | null, keys: string[], fallback: unknown = ''): unknown {
  if (!settings) return fallback

  for (const key of keys) {
    if (settings[key] !== undefined && settings[key] !== null && settings[key] !== '') {
      return settings[key]
    }
  }

  return fallback
}

function readNumberSetting(settings: UserSettings | null, keys: string[], fallback = 0): number {
  return toNumber(readSetting(settings, keys, fallback), fallback)
}

function readStringSetting(settings: UserSettings | null, keys: string[], fallback = ''): string {
  return String(readSetting(settings, keys, fallback))
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '')
}

function milkAliases(milkType: MilkType): string[] {
  if (milkType === 'Cow milk') return ['cowmilk', 'cow']
  if (milkType === 'Sheep milk') return ['sheepmilk', 'sheep']
  if (milkType === 'Buffalo milk') return ['buffalomilk', 'buffalo']
  if (milkType === 'Goat milk') return ['goatmilk', 'goat']
  return [normalize(milkType)]
}

function matchMilkItem(entry: CompletedMilkEntry, items: LocalItem[]): LocalItem | undefined {
  const wanted = milkAliases(entry.milkType)
  const candidates = items.filter((item) => normalize(item.item_offline_type) === 'milkcollection')

  return candidates.find((item) => wanted.includes(normalize(item.item_utbl04)))
    ?? candidates.find((item) => wanted.includes(normalize(item.item_descr)))
    ?? candidates.find((item) => wanted.some((alias) => normalize(item.item_descr).includes(alias)))
    ?? candidates.find((item) => wanted.includes(normalize(item.item_code)))
}

function toDateKey(value: string): string {
  return value.slice(0, 10)
}

function createInternalNumber(collection: SubmittedCollection): string {
  const datePart = collection.submittedAt.replace(/\D/g, '').slice(2, 14)
  const supplierPart = String(collection.supplier.id).replace(/\D/g, '').slice(-4).padStart(4, '0')
  return String(toNumber(`${datePart}${supplierPart}`.slice(-9), Date.now() % 1000000000))
}

function getQty2(qty1: number, item: LocalItem): number {
  if (item.item_mu21_rel > 0) return qty1 / item.item_mu21_rel
  return qty1
}

export async function createSuppliesOrderPayload(
  collection: SubmittedCollection,
  user: AuthUser,
): Promise<ERP_SuppliesPickingOrder[]> {
  const completedEntries = collection.entries.filter(
    (entry): entry is CompletedMilkEntry => Boolean(entry.milkType) && Number(entry.kg) > 0,
  )

  if (completedEntries.length === 0) {
    throw new Error('No milk quantities were entered.')
  }

  const items = await db.items.toArray()
  const transport = await db.transportDetails.get('current')
  const internalnum = createInternalNumber(collection)
  const settings = user.settings
  const salespickingseries = readNumberSetting(settings, [
    'salespickingseries',
    'salesPickingSeries',
    'sales_picking_series',
  ])
  const frombranch = readStringSetting(settings, ['frombranch', 'fromBranch'])
  const fromstore = readStringSetting(settings, ['fromstore', 'fromStore', 'fromwhouse'])
  const fromposition = readStringSetting(settings, ['fromposition', 'fromPosition'])
  const tobranch = readStringSetting(settings, ['tobranch', 'toBranch'])
  const tostore = readStringSetting(settings, ['tostore', 'toStore', 'towhouse'])
  const toposition = readStringSetting(settings, ['toposition', 'toPosition'])
  const buyerid = readStringSetting(settings, ['buyerid', 'buyerId'])
  const carrierid = readStringSetting(settings, ['carrierid', 'carrierId'])
  const shipkindid = readStringSetting(settings, ['shipkindid', 'shipkindId'])
  const shipmentid = readStringSetting(settings, ['shipmentid', 'shipmentId'])
  const countryid = readStringSetting(settings, ['countryid', 'countryId'])

  return completedEntries.map((entry) => {
    const item = matchMilkItem(entry, items)

    if (!item) {
      throw new Error(`No synced ERP item matched milk type "${entry.milkType}".`)
    }

    const qty1 = Number(entry.kg)
    const barcode = entry.barcode.trim()

    return {
      order_id: 0,
      ftr_row_id: 0,
      cus_id: toNumber(collection.supplier.id),
      username: user.username,
      salespickingseries,
      store: fromstore,
      store_id: fromstore,
      position: fromposition,
      position_id: fromposition,
      item_id: item.item_id,
      item_code: item.item_code,
      qty1,
      qty2: getQty2(qty1, item),
      price: 0,
      disc1prc: 0,
      disc2prc: 0,
      lot_id: 0,
      lot_lot: '',
      pal_code: '',
      item_extra_field: '',
      item_comments: `${entry.milkType} ${qty1}kg`.trim(),
      frombranch,
      fromstore,
      fromposition,
      tobranch,
      tostore,
      toposition,
      transportnum: transport?.truckNumber ?? '',
      comments: `${collection.supplier.code} ${entry.milkType}`.trim(),
      sampleid: barcode,
      countryid,
      compartmentid: '',
      buyerid,
      internalnum,
      setdate: toDateKey(collection.submittedAt),
      origin_supid: toNumber(collection.supplier.id),
      carrierid,
      shipkindid,
      shipmentid,
    }
  })
}

export async function sendSuppliesOrderToErp(
  collection: SubmittedCollection,
  user: AuthUser,
  signal?: AbortSignal,
): Promise<ERP_RetFunc> {
  const { apiUsername, apiPassword, defaultFiscalYear } = settingsStore.get()

  if (!apiUsername || !apiPassword) {
    throw new Error('API credentials not configured. Open Settings first.')
  }

  const payload = await createSuppliesOrderPayload(collection, user)
  const loginResponse = await login(
    { Username: apiUsername, Password: apiPassword, fiscalyear: defaultFiscalYear },
    signal,
  )
  const response = await saveZGParalavesSuppliesOrder(
    payload,
    signal,
    loginResponse.access_token,
  )

  if (!response.status) {
    throw new Error(response.status_message || 'ERP rejected the supplies order.')
  }

  return response
}
