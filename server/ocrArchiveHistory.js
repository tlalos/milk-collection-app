import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const historyDir = path.join(rootDir, 'data', 'ocr')
const historyPath = path.join(historyDir, 'archive-history.json')

export async function upsertArchiveHistory(record) {
  await mkdir(historyDir, { recursive: true })
  const history = await readArchiveHistory()
  const index = history.records.findIndex((item) => item.jobId === record.jobId)
  const nextRecord = {
    ...history.records[index],
    ...record,
    updatedAt: new Date().toISOString(),
  }
  const records = index >= 0
    ? history.records.map((item, itemIndex) => itemIndex === index ? nextRecord : item)
    : [nextRecord, ...history.records]
  return writeArchiveHistory({
    version: 1,
    updatedAt: new Date().toISOString(),
    records,
  })
}

export async function readArchiveHistoryBuffer() {
  await mkdir(historyDir, { recursive: true })
  await readArchiveHistory()
  return readFile(historyPath)
}

export async function readArchiveHistory() {
  try {
    const parsed = JSON.parse(await readFile(historyPath, 'utf8'))
    return {
      version: 1,
      updatedAt: parsed.updatedAt || null,
      records: Array.isArray(parsed.records) ? parsed.records : [],
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    return writeArchiveHistory({ version: 1, updatedAt: new Date().toISOString(), records: [] })
  }
}

async function writeArchiveHistory(history) {
  await mkdir(historyDir, { recursive: true })
  const temporary = `${historyPath}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(history, null, 2), 'utf8')
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rename(temporary, historyPath)
      return history
    } catch (error) {
      lastError = error
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }

  try {
    await copyFile(temporary, historyPath)
    await rm(temporary, { force: true })
  } catch (fallbackError) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw fallbackError?.code ? fallbackError : lastError
  }
  return history
}
