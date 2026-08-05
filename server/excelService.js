import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse as parseEnv } from 'dotenv'

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0'
const defaultExcelProject = 'C:\\Users\\tlalos\\Documents\\Codex\\2026-07-31\\excel-to-erp-soft1-codex-text\\excel-to-erp-soft1'

async function loadConfig() {
  const projectDir = process.env.EXCEL_GRAPH_PROJECT_DIR || defaultExcelProject
  const inherited = parseEnv(await readFile(path.join(projectDir, '.env'), 'utf8'))
  const env = { ...inherited, ...process.env }
  return {
    tenantId: env.AZURE_TENANT_ID || 'organizations',
    clientId: env.AZURE_CLIENT_ID,
    workbookUrl: env.GRAPH_WORKBOOK_URL,
    driveId: env.GRAPH_DRIVE_ID,
    itemId: env.GRAPH_ITEM_ID,
    scopes: env.GRAPH_SCOPES || 'Files.ReadWrite offline_access',
    tokenCachePath: env.EXCEL_GRAPH_TOKEN_CACHE || path.join(projectDir, '.graph-token-cache.json'),
    tableName: env.OCR_EXCEL_TABLE_NAME || 'tblDailyRoutes',
    sheetName: env.OCR_EXCEL_SHEET_NAME || 'Daily_Routes',
    milkCode: env.OCR_EXCEL_DEFAULT_MILK_CODE || 'MILK-COW',
    antibioticsStatus: env.OCR_EXCEL_ANTIBIOTICS_STATUS || 'OK',
  }
}

export async function appendReviewedDocumentToExcel(job) {
  const config = await loadConfig()
  if (!config.clientId || (!config.workbookUrl && !(config.driveId && config.itemId))) {
    throw new Error('Excel Online is not configured with the Azure client and workbook target.')
  }
  if (!job.data?.rows?.length) throw new Error('The reviewed document has no collection rows to export.')

  const missingHeader = [
    ['date', job.data.date], ['driver', job.data.driverName], ['truck', job.data.vehicleRegistration], ['route', job.data.route],
  ].filter(([, value]) => !value).map(([name]) => name)
  if (missingHeader.length) throw new Error(`Cannot export: missing ${missingHeader.join(', ')}.`)

  const token = await refreshAccessToken(config)
  const workbook = await resolveWorkbook(config, token)
  const workbookPath = `/drives/${encodeURIComponent(workbook.driveId)}/items/${encodeURIComponent(workbook.itemId)}/workbook`
  // Sessionless range writes are substantially faster for this large, formula-heavy workbook.
  const headers = {}
  const tablePath = `${workbookPath}/tables/${encodeURIComponent(config.tableName)}`
  const columns = await graphFetch(`${tablePath}/columns`, token, { headers })
  const columnNames = (columns.value || []).map((column) => column.name)
  if (!columnNames.length) throw new Error(`Excel table ${config.tableName} has no columns.`)

  const rowIdRange = await graphFetch(`${tablePath}/columns/${encodeURIComponent('Row_ID')}/dataBodyRange`, token, { headers })
  const rowIdValues = (rowIdRange.values || []).flat()
  const existingIds = rowIdValues.map(Number).filter(Number.isFinite)
  let nextRowId = (existingIds.length ? Math.max(...existingIds) : 0) + 1
  const lastUsedIndex = rowIdValues.reduce((last, value, index) => value !== null && value !== '' ? index : last, -1)
  const startIndex = lastUsedIndex + 1
  const dateSerial = toExcelSerial(job.data.date)

  const values = job.data.rows.map((row) => {
    const missing = [
      ['center', row.collectionCenter], ['liters', row.liters], ['notice number', row.noticeNumber],
    ].filter(([, value]) => value === null || value === undefined || value === '').map(([name]) => name)
    if (missing.length) throw new Error(`Cannot export OCR row ${row.rowNumber}: missing ${missing.join(', ')}.`)

    const mapped = {
      Row_ID: nextRowId++,
      Date: dateSerial,
      Driver: job.data.driverName,
      Truck: job.data.vehicleRegistration,
      Route_ID: job.data.route,
      Aviz_No: row.noticeNumber,
      Center_Name: row.collectionCenter,
      Milk_Code: config.milkCode,
      Qty_Collected_L: row.liters,
      'Fat/Densitate': row.fatPercent ?? row.density,
      Temperature_C: row.temperature,
      Antibiotics_Status: config.antibioticsStatus,
      Water_Percent: row.water,
      Comments: '',
      ERP_Action: 'Create',
      ERP_Status: '',
    }
    return columnNames.slice(0, 14).map((name) => Object.hasOwn(mapped, name) ? mapped[name] : null)
  })

  if (startIndex + values.length > rowIdValues.length) {
    throw new Error(`Excel table ${config.tableName} has no remaining preallocated rows.`)
  }
  const bodyStartRow = Number(rowIdRange.address?.match(/![A-Z]+(\d+):/u)?.[1])
  if (!bodyStartRow) throw new Error('Could not determine the Daily_Routes table row address.')
  const excelStartRow = bodyStartRow + startIndex
  const excelEndRow = excelStartRow + values.length - 1
  const worksheets = await graphFetch(`${workbookPath}/worksheets`, token, { headers })
  const worksheet = (worksheets.value || []).find((item) => item.name.toLowerCase() === config.sheetName.toLowerCase())
  if (!worksheet) throw new Error(`Excel worksheet ${config.sheetName} was not found.`)
  const targetAddress = `A${excelStartRow}:N${excelEndRow}`
  await graphFetch(`${workbookPath}/worksheets/${encodeURIComponent(worksheet.id)}/range(address='${targetAddress}')`, token, {
    method: 'PATCH', headers, body: JSON.stringify({ values }),
  })
  return { workbook: workbook.name, table: config.tableName, rowCount: values.length, range: targetAddress }
}

function toExcelSerial(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number)
  return (Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000
}

async function refreshAccessToken(config) {
  const cached = JSON.parse(await readFile(config.tokenCachePath, 'utf8'))
  if (!cached.refresh_token) throw new Error('The Excel Graph token cache has no refresh token. Sign in from the Excel integration project first.')
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, scope: config.scopes, refresh_token: cached.refresh_token, grant_type: 'refresh_token' }),
  })
  const token = await parseResponse(response, 'refresh Microsoft Graph token')
  await writeFile(config.tokenCachePath, JSON.stringify(token, null, 2), 'utf8')
  return token.access_token
}

async function resolveWorkbook(config, token) {
  if (config.driveId && config.itemId) return { driveId: config.driveId, itemId: config.itemId, name: config.itemId }
  const base64 = Buffer.from(config.workbookUrl, 'utf8').toString('base64')
  const shareId = `u!${base64.replace(/=+$/u, '').replace(/\//gu, '_').replace(/\+/gu, '-')}`
  const item = await graphFetch(`/shares/${shareId}/driveItem`, token, { headers: { Prefer: 'redeemSharingLinkIfNecessary' } })
  if (!item.parentReference?.driveId || !item.id) throw new Error('Could not resolve the Excel Online workbook.')
  return { driveId: item.parentReference.driveId, itemId: item.id, name: item.name }
}

async function graphFetch(pathname, token, options = {}) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', ...options.headers }
  if (options.body) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${GRAPH_ROOT}${pathname}`, { ...options, headers })
  return parseResponse(response, `${options.method || 'GET'} ${pathname}`)
}

async function parseResponse(response, context) {
  const text = await response.text()
  let body = null
  if (text) {
    try { body = JSON.parse(text) } catch { body = { message: text } }
  }
  if (!response.ok) throw new Error(body?.error?.message || body?.error_description || body?.message || `${context} failed (${response.status}).`)
  return body || {}
}
