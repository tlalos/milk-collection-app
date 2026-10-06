import { createHash } from 'node:crypto'
import { erpConnectionStore, normalizeErpUrl } from './erpConnectionStore.js'

const items = { 'MILK-COW': [16551, 'MF0010'], 'MILK-SHEEP': [17119, 'mff0000000000038'], 'MILK-BUFF': [17155, 'mff0000000000042'] }
const normalized = value => String(value ?? '').trim().toLowerCase()
const money = value => Math.round((value + Number.EPSILON * Math.abs(value)) * 100) / 100
const unitPrice = value => Math.round((value + Number.EPSILON * Math.abs(value)) * 1e6) / 1e6

export function buildInvoicePreview(row, supplier, date, username, params = {}) {
  if (!row || row.producerWarning || row.duplicateProducer || row.approvalReviewRequired || row.missingLiters || !row.readyForPricing) throw new Error(row?.producerWarning || 'Resolve this row\'s pricing or producer warnings first.')
  if (row.source !== 'aviz' && (row.reconciliationDifferenceLiters == null || !Number.isFinite(row.reconciliationDifferenceLiters) || Math.abs(row.reconciliationDifferenceLiters) > 10 || ['missing_aviz', 'missing_monthly'].includes(row.reconciliationStatus))) throw new Error('Unresolved journal/aviz comparison.')
  if (normalized(supplier?.sup_code) !== normalized(row.producerCode) || !/^p\S+$/i.test(row.producerCode)) throw new Error('No exact ERP producer match.')
  if (row.price == null) throw new Error('Collector procedure pending.')
  if (!Number.isFinite(row.liters) || row.liters <= 0) throw new Error('Positive liters are required.')
  for (const amount of [row.price, row.commission ?? 0, row.electricity ?? 0]) if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid saved pricing.')
  const series = normalized(supplier.sup_bool02) === '0' ? 5106 : normalized(supplier.sup_bool02) === '1' ? 5105 : null
  if (!series) throw new Error('ERP Bool2 must be 0 or 1.')
  const payment = String(supplier.sup_payment ?? '').trim()
  if (!/^\d+$/.test(payment) || !Number.isSafeInteger(Number(payment))) throw new Error('Missing or invalid ERP payment code.')
  const supplierId = Number(supplier.sup_id)
  if (!Number.isSafeInteger(supplierId) || supplierId <= 0) throw new Error('Invalid ERP supplier ID.')
  if (!items[row.milkType]) throw new Error('Invoice item mapping is not confirmed for this milk type.')
  const extra = ['1', 'true', 'yes'].includes(normalized(supplier.sup_bool01))
  const vatName = supplier.sup_vatstatusname ?? supplier.sup_vatstatus_name ?? supplier.supVatStatusName ?? supplier.vatStatusName
    ?? ({ '0': 'is exempted', '1': 'regular', '2': 'reduced' }[String(supplier.sup_vatsts)])
  if (vatName == null && !extra) throw new Error('ERP VAT status is missing.')
  const vatid = extra ? '8' : normalized(vatName) === 'regular' ? '11' : '99'
  const originalSubtotal = row.price * row.liters + (row.commission ?? 0) + (row.electricity ?? 0)
  const price = unitPrice(originalSubtotal / row.liters)
  if (price <= 0) throw new Error('Invoice price rounds to zero.')
  const subtotal = money(price * row.liters)
  const tax = money(subtotal * (vatid === '8' ? 0.08 : vatid === '11' ? 0.11 : 0))
  const internalnum = String(Number(`${date.replace(/\D/g, '').slice(2, 8)}${String(supplierId).slice(-4).padStart(4, '0')}`.slice(-9)))
  const payload = [{
    order_id: 0, ftr_row_id: 0, cus_id: supplierId, origin_supid: supplierId, username,
    salespickingseries: series, setdate: date, internalnum, paymentid: payment,
    store: '110', store_id: '110', fromstore: '110', tostore: '0',
    frombranch: String(params.par_from_branch ?? ''), tobranch: String(params.par_to_branch ?? ''),
    position: '', position_id: '', fromposition: '', toposition: '',
    item_id: items[row.milkType][0], item_code: items[row.milkType][1], qty1: row.liters, qty2: row.liters, price, vatid,
    disc1prc: 0, disc2prc: 0, lot_id: 0, lot_lot: '', pal_code: '', item_extra_field: '',
    item_comments: `${row.milkType} ${row.liters} L`, comments: '', transportnum: '', sampleid: '',
    countryid: '', compartmentid: '', buyerid: '', carrierid: '', shipkindid: '', shipmentid: '',
    fat: '', density: '', temperature: '', water: '', alcohol: '', antibiotic: '', silo: '', ph: '', mobility: '',
  }]
  const snapshot = { month: row.month, producerCode: row.producerCode, producerName: row.producer, milkType: row.milkType, invoiceDate: date,
    liters: row.liters, originalPrice: row.price, commission: row.commission, electricity: row.electricity,
    price, originalSubtotal: money(originalSubtotal), subtotal, tax, total: money(subtotal + tax), roundingDifference: money(subtotal - money(originalSubtotal)), series, paymentid: Number(payment), internalnum }
  const fingerprint = createHash('sha256').update(JSON.stringify({ snapshot, payload })).digest('hex')
  return { snapshot, payload, fingerprint }
}

export async function connectInvoiceErp(connection, fetchImpl = fetch, connectionStore = erpConnectionStore) {
  const { serverUrl: configured } = await connectionStore.get()
  if (!configured) throw new Error('Save the shared ERP URL in OCR connection settings before sending.')
  if (normalizeErpUrl(connection?.serverUrl) !== configured) throw new Error('ERP destination changed. Refresh the connection settings before retrying.')
  if (!connection.apiUsername || !connection.apiPassword) throw new Error('Configure the OCR ERP credentials first.')
  async function call(path, body, token) {
    const response = await fetchImpl(`${configured}/${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
    })
    if (!response.ok) {
      const error = new Error(`ERP request failed (${response.status}).`)
      if (path === 'WMS/ERP_SaveRomZGParalavesSuppliesOrder') {
        const body = (await response.text().catch(() => '')).slice(0, 8000)
        let detail = body
        try {
          const parsed = JSON.parse(body)
          detail = typeof parsed === 'string' ? parsed : parsed.status_message || parsed.Message || parsed.message || parsed.title || body
          if (parsed.errors) detail += ` ${JSON.stringify(parsed.errors)}`
        } catch { /* Non-JSON responses are retained as diagnostic text. */ }
        error.erpResponse = { httpStatus: response.status, body }
        error.message += detail ? ` ${String(detail).slice(0, 2000)}` : ' ERP returned no error details.'
      }
      throw error
    }
    let parsed = await response.json()
    if (typeof parsed === 'string') parsed = JSON.parse(parsed)
    return parsed
  }
  const login = await call('Accounts/Login', { Username: connection.apiUsername, Password: connection.apiPassword, fiscalyear: connection.defaultFiscalYear })
  if (!login?.access_token) throw new Error('ERP login returned no token.')
  const username = connection.apiUsername.trim()
  const query = new URLSearchParams({ mode: 'ALL', username })
  const suppliers = await call(`WMS/ERP_RomSuppliersList?${query}`, undefined, login.access_token)
  if (!Array.isArray(suppliers) || !suppliers.length) throw new Error('ERP supplier list is empty or invalid.')
  // ERP resolves the sender configuration from the payload username too.
  const operationalUsername = 'zg1'
  const params = await call(`WMS/ERP_RomZgParam?${new URLSearchParams({ username: operationalUsername })}`, undefined, login.access_token)
  if (!Array.isArray(params) || !params.length || !params[0]) throw new Error('ERP branch parameters for zg1 are empty or invalid. No invoice was sent.')
  return { suppliers, params: params[0], username: operationalUsername, send: payload => call('WMS/ERP_SaveRomZGParalavesSuppliesOrder', payload, login.access_token) }
}

export async function executeInvoiceSend(preview, claim, finish, send) {
  const attempt = await claim()
  let response
  try {
    response = await send(preview.payload)
    if (response?.status !== true || !response.newid || String(response.newid) === '0') throw new Error(response?.status_message || 'ERP did not confirm an invoice ID. Check ERP before retrying.')
  } catch (error) {
    await finish({ attemptId: attempt.attemptId, response: response ?? error.erpResponse, error: error.message })
    throw new Error(`${error.message} Invoice locked for ERP verification.`)
  }
  // A persistence failure must never trigger a second ERP request or overwrite success.
  await finish({ attemptId: attempt.attemptId, erpId: response.newid, response })
  return { erpId: String(response.newid) }
}
