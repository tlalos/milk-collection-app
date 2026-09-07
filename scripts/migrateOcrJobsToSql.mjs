import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { closeSqlOcrStore, initializeSqlOcrStore, saveSqlJob } from '../server/sqlOcrStore.js'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: path.join(rootDir, '.env') })

const jobsDir = path.join(rootDir, 'data', 'ocr', 'jobs')

try {
  await initializeSqlOcrStore()

  const files = (await readdir(jobsDir)).filter((file) => file.endsWith('.json'))
  let imported = 0
  for (const file of files) {
    const job = JSON.parse(await readFile(path.join(jobsDir, file), 'utf8'))
    await saveSqlJob(job)
    imported += 1
  }

  console.log(`Imported ${imported} OCR jobs into SQL Server.`)
} finally {
  await closeSqlOcrStore()
}
