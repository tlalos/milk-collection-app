import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  getSqlErpReferenceSnapshot,
  isSqlOcrStoreEnabled,
  saveSqlErpReferenceSnapshot,
} from './sqlOcrStore.js'

const snapshotPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'ocr', 'erp-reference-snapshot.json')
const producerFields = [
  'centerCode', 'centerName', 'trn', 'primaryAddress', 'zip', 'city', 'primaryPhone',
  'exploitationCode', 'active', 'vatStatusName', 'bankCode', 'iban', 'extra', 'bool2',
]

function normalizeItems(items, prefix, mapItem) {
  if (!Array.isArray(items)) throw new Error('ERP supplier response must contain center and producer lists.')
  const seen = new Set()
  return items.map(mapItem).filter((item) => {
    const code = String(item.code || item.producerCode || '').toLowerCase()
    if (!code.startsWith(prefix) || !(item.name || item.producerName) || seen.has(code)) return false
    seen.add(code)
    return true
  })
}

export function normalizeErpReferenceSnapshot(references) {
  const centers = normalizeItems(references?.centers, 'c', (center) => ({
    code: String(center?.code || '').trim(),
    name: String(center?.name || '').trim(),
  }))
  const producers = normalizeItems(references?.producers, 'p', (producer) => ({
    producerCode: String(producer?.producerCode || '').trim(),
    producerName: String(producer?.producerName || '').trim(),
    ...Object.fromEntries(producerFields.map((field) => [field, String(producer?.[field] ?? '').trim()])),
  }))
  if (!centers.length || !producers.length) {
    throw new Error('ERP supplier response must include at least one C* center and one P* producer. The saved list was not changed.')
  }
  return { centers, producers }
}

export async function getErpReferenceSnapshot() {
  if (isSqlOcrStoreEnabled()) return getSqlErpReferenceSnapshot()
  try {
    const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'))
    return snapshot?.fetchedAt && Array.isArray(snapshot.centers) && Array.isArray(snapshot.producers) ? snapshot : null
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

export async function requireErpReferenceSnapshot() {
  const snapshot = await getErpReferenceSnapshot()
  if (!snapshot) {
    const error = new Error('ERP supplier list is not saved on this server. Use Fetch ERP list on the OCR page first.')
    error.status = 503
    throw error
  }
  return snapshot
}

export async function saveErpReferenceSnapshot(references) {
  const normalized = normalizeErpReferenceSnapshot(references)
  const snapshot = { ...normalized, fetchedAt: new Date().toISOString(), source: 'erp' }
  if (isSqlOcrStoreEnabled()) {
    await saveSqlErpReferenceSnapshot(snapshot)
    return snapshot
  }

  await mkdir(path.dirname(snapshotPath), { recursive: true })
  const temporary = `${snapshotPath}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(snapshot), 'utf8')
  try {
    await rename(temporary, snapshotPath)
  } catch (error) {
    if (error?.code !== 'EPERM' && error?.code !== 'EACCES') {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
    try {
      await copyFile(temporary, snapshotPath)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }
  return snapshot
}
