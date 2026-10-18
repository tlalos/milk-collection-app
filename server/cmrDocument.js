import { z } from 'zod'

const text = z.string().trim().max(300)
const quantity = z.number().finite().nonnegative().max(999999999).nullable()
const date = z.string().refine(value => value === '' || (/^\d{4}-\d{2}-\d{2}$/u.test(value)
  && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value), 'Enter a valid date.')

export const CmrDataSchema = z.object({
  documentType: z.literal('cmr'),
  supplier: text,
  transport: text,
  driver: text.default(''),
  truckNumber: text.default(''),
  kilos: z.number().finite().nonnegative().max(999999999).nullable(),
  date,
  avizNumber: text,
  recipient: text.default(''),
  deliveryLocation: text.default(''),
  deliveryDate: date.default(''),
  loadingLocation: text.default(''),
  loadingDate: date.default(''),
  avizDate: date.default(''),
  issueDate: date.default(''),
  receiptDate: date.default(''),
  milkType: z.enum(['', 'MILK-COW', 'MILK-SHEEP', 'MILK-GOAT', 'MILK-BUFF']).default(''),
  quantity: quantity.optional(),
  quantityUnit: z.enum(['', 'kg', 'L']).default('kg'),
}).strict()

export function emptyCmrData() {
  return CmrDataSchema.parse({ documentType: 'cmr', supplier: '', transport: '', driver: '', truckNumber: '', kilos: null, date: '', avizNumber: '', quantity: null })
}

export function registerCmrRoutes(app, { getJob, listJobs, updateJob, deleteJob, toPublicJob, auditAction, listMilkReceptions, getCmrReceptionMatch, saveCmrReceptionMatch, enqueueOcrJob, getOcrSettings, isOcrProviderConfigured, OCR_PROVIDERS }) {
  app.post('/api/ocr/cmr/:id/recognize', async (request, response, next) => {
    try {
      const before = await getJob(request.params.id)
      if (!before || before.documentCategory !== 'cmr') return response.status(404).json({ error: 'CMR document not found.' })
      if (['queued', 'processing'].includes(before.status)) return response.status(409).json({ error: 'This document is already being recognized.' })
      if (request.body?.updatedAt !== before.updatedAt) return response.status(409).json({ error: 'This document has changed. Reload before recognition.' })
      const settings = await getOcrSettings()
      if (!isOcrProviderConfigured(OCR_PROVIDERS[settings.provider])) return response.status(503).json({ error: 'The selected OCR provider is not configured on the server.' })
      // Keep the last saved fields and original reading until a new extraction succeeds.
      const job = await updateJob(before.id, { status: 'queued', reviewStatus: 'pending', reviewedAt: null, startedAt: null, completedAt: null, error: null,
        updatedBy: request.authUser?.username || '',
      }, { expectedUpdatedAt: before.updatedAt })
      await auditAction({ request, user: request.authUser, action: 'cmr.recognize', entityType: 'CmrDocument', entityId: before.id, before: { data: before.data, ocrOriginalData: before.ocrOriginalData, cmrOcr: before.cmrOcr }, after: { status: 'queued' } })
      enqueueOcrJob(before.id)
      response.status(202).json({ job: toPublicJob(job, true) })
    } catch (error) { next(error) }
  })
  app.get('/api/ocr/cmr/:id/reception-match', async (request, response, next) => {
    try { response.set('Cache-Control', 'no-store').json(await getCmrReceptionMatch(request.params.id)) }
    catch (error) { next(error) }
  })
  app.put('/api/ocr/cmr/:id/reception-match', async (request, response, next) => {
    try { response.json(await saveCmrReceptionMatch(request.params.id, request.body, request.authUser)) }
    catch (error) { next(error) }
  })
  app.get('/api/ocr/cmr/truck-options', async (request, response, next) => {
    const parsed = date.safeParse(request.query.date)
    if (!parsed.success || !parsed.data) return response.status(400).json({ error: 'Choose a valid document date.' })
    try {
      const records = await listMilkReceptions({ date: parsed.data, month: parsed.data.slice(0, 7), includeQualityDetails: false })
      const trucks = new Map()
      const drivers = new Map()
      for (const record of records) {
        if (record.receptionDate?.slice(0, 10) !== parsed.data || record.vehicleCategory !== 'OTHER') continue
        const registration = String(record.vehicleRegistration || '').trim()
        const key = registration.toUpperCase().replace(/[^A-Z0-9]/gu, '')
        if (key && !trucks.has(key)) trucks.set(key, registration)
        const driver = String(record.driverName || '').trim().replace(/\s+/gu, ' ')
        const driverKey = driver.toLocaleUpperCase('ro-RO')
        if (driverKey && !drivers.has(driverKey)) drivers.set(driverKey, driver)
      }
      response.set('Cache-Control', 'no-store').json({
        trucks: [...trucks.values()].sort((a, b) => a.localeCompare(b)),
        drivers: [...drivers.values()].sort((a, b) => a.localeCompare(b)),
      })
    } catch (error) { next(error) }
  })

  app.get('/api/ocr/cmr', async (_request, response, next) => {
    try {
      const jobs = (await listJobs()).filter(job => job.documentCategory === 'cmr')
      response.json({ jobs: jobs.map(job => toPublicJob(job, true)) })
    } catch (error) { next(error) }
  })

  app.patch('/api/ocr/cmr/:id', async (request, response, next) => {
    try {
      const before = await getJob(request.params.id)
      if (!before || before.documentCategory !== 'cmr') return response.status(404).json({ error: 'CMR document not found.' })
      if (['queued', 'processing'].includes(before.status)) return response.status(409).json({ error: 'Wait for recognition to finish before editing.' })
      if (request.body?.data?.quantity === undefined && before.data?.quantity !== undefined) {
        return response.status(409).json({ error: 'Reload this page to use the updated CMR quantity and unit fields.' })
      }
      const parsed = CmrDataSchema.safeParse({ ...before.data, ...request.body?.data })
      if (!parsed.success) return response.status(400).json({ error: 'Check the CMR fields. Quantity must be a non-negative number, the unit must be kg or L, and dates must be valid.' })
      if (request.body.updatedAt !== before.updatedAt) return response.status(409).json({ error: 'This document has changed. Reload it before saving.' })
      const data = parsed.data
      if (data.quantity !== undefined) data.kilos = data.quantityUnit === 'kg' ? data.quantity : null
      const markReviewed = request.body.markReviewed === true
      const requiredFields = { date: 'Reception date', milkType: 'Milk type', quantity: 'Quantity', quantityUnit: 'Unit', receiptDate: 'Goods receipt date', supplier: 'Supplier', issueDate: 'CMR issue date', truckNumber: 'Truck number', avizNumber: 'Aviz number' }
      const missingFields = Object.keys(requiredFields).filter(key => data[key] == null || data[key] === '')
      if (markReviewed && missingFields.length) {
        return response.status(400).json({ error: `Complete before marking reviewed: ${missingFields.map(key => requiredFields[key]).join(', ')}.`, missingFields })
      }
      if (markReviewed && before.status !== 'completed') return response.status(409).json({ error: 'Retry failed OCR before marking reviewed.' })
      const verifiedFields = [...new Set([...(before.cmrOcr?.verifiedFields || []), ...Object.keys(data).filter(key => data[key] !== before.data?.[key])])]
      const job = await updateJob(before.id, { data, reviewStatus: markReviewed ? 'reviewed' : 'pending', reviewedAt: markReviewed ? new Date().toISOString() : null,
        ...(before.cmrOcr ? { cmrOcr: { ...before.cmrOcr, verifiedFields } } : {}),
        updatedBy: request.authUser?.username || '' }, { expectedUpdatedAt: before.updatedAt })
      await auditAction({ request, user: request.authUser, action: markReviewed ? 'cmr.review' : 'cmr.update', entityType: 'CmrDocument', entityId: before.id, before: before.data, after: job.data })
      response.json({ job: toPublicJob(job, true) })
    } catch (error) { next(error) }
  })

  app.delete('/api/ocr/cmr/:id', async (request, response, next) => {
    try {
      const before = await getJob(request.params.id)
      if (!before || before.documentCategory !== 'cmr') return response.status(404).json({ error: 'CMR document not found.' })
      if (['queued', 'processing'].includes(before.status)) return response.status(409).json({ error: 'Wait for recognition to finish before deleting.' })
      await deleteJob(before.id)
      await auditAction({ request, user: request.authUser, action: 'cmr.delete', entityType: 'CmrDocument', entityId: before.id, before: before.data })
      response.json({ deleted: true })
    } catch (error) { next(error) }
  })

  // CMR uses its own recognition/review routes, never daily/monthly ERP actions.
  app.use('/api/ocr/jobs/:id', async (request, response, next) => {
    try {
      if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next()
      const job = await getJob(request.params.id)
      if (job?.documentCategory === 'cmr') return response.status(400).json({ error: 'Use the CMR page for recognition and review. ERP actions are not available for CMR.' })
      next()
    } catch (error) { next(error) }
  })
}
