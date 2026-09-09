import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { Agent } from 'undici'
import sharp from 'sharp'
import { MilkCollectionDocumentSchema, MonthlySettlementDocumentSchema } from './ocrSchema.js'
import { calculateOpenAiCost } from './openaiCost.js'
import { getOcrSettings, OCR_PROVIDERS } from './ocrSettingsStore.js'

const EXTRACTION_PROMPT = `Extract this Romanian milk-collection daily driver statement into the supplied schema.

Rules:
- Read printed and handwritten text. Preserve Romanian names as written; do not translate them.
- Dates must be returned as YYYY-MM-DD only when unambiguous. Otherwise return null and explain in warnings.
- Extract only non-empty collection rows. Keep their printed row numbers.
- Column meanings: collection center name, liters, fat percentage (Gr %), density/U.G., water/APA, temperature/TEMP, notice number/AVIZ.
- For each row, set milkType to one of MILK-COW, MILK-SHEEP, MILK-GOAT, MILK-BUFF. Use visible document text when present. Otherwise infer from fat percentage: cow is usually 3.3-4.2, sheep 6.0-7.0, buffalo 7.0-8.0, goat 3.5-4.5. Because goat is uncommon and overlaps cow, prefer MILK-COW over MILK-GOAT unless goat is explicitly written.
- Romanian decimal commas are decimal points in JSON numbers (for example 3,8 becomes 3.8).
- Do not infer illegible values. Use null, add the field name to uncertainFields, and describe significant ambiguity in warnings.
- confidence is an estimate from 0 to 1 for each entire row.
- totalLiters must be the handwritten total when clearly visible. Do not calculate it as a substitute. Mention disagreement with the row sum in warnings.
- rawTranscription should contain a concise line-by-line transcription of all populated handwritten fields.
- Signatures are not data fields and must not be identified.`

const MONTHLY_SETTLEMENT_PROMPT = `Extract this Romanian milk collection JOURNAL MONTHLY SETTLEMENT document.

First identify the layout:
- detailed: a wide handwritten daily grid with producer names in the first column, day columns, and final TOTAL / U.G. columns.
- overview: a printed summary grid with a collection center in the header and producer rows with liters, G. and U.G. columns.

Rules:
- Preserve Romanian names as written. Return date as YYYY-MM-DD only when an exact calendar day is visible. When only a month is identifiable, return date as null and put its month number (1-12) in documentMonth. Otherwise documentMonth is null. The server will use the last day of that month in the current year.
- Detect the document milk type from the header. Return milkType using exactly one of MILK-COW, MILK-SHEEP, MILK-GOAT, MILK-BUFF. For example, VACA means MILK-COW, OAIE means MILK-SHEEP, CAPRA means MILK-GOAT, and BIVOL means MILK-BUFF. If no document-level milk type is visible, return MILK-COW.
- Each output row must include milkType using the same MILK-* codes. If a row or section is labelled VACA, BIVOL, OAIE, or CAPRA, convert it to the matching MILK-* code on that row. If the row has no separate visible milk type, use the document milkType.
- Some handwritten detailed journals have one producer name at the top and then dated quantity entries underneath, for example SITA - SERBAN followed by 03/07 242, 04/07 77, and TOTAL 2319. For those pages, return exactly one row for the producer using the final TOTAL as liters; do not return the individual dated entries as rows.
- Some single-producer journals have separate milk type sections, for example a VACA total and a BIVOL total. For those pages, return one row per milk type total for that producer; do not return the individual daily date rows.
- For detailed documents, headerCenterName is the collection center written above the grid on the left. For each populated producer row extract the producer name and the final far-right TOTAL L column into liters. Extract a true U.G. percentage into ugPercent. Extract the accumulated U.G. Total into gValue. Do not extract intermediate daily cells.
- Some detailed forms have no handwritten U.G. percentage but do have U.G. Total. In that case leave ugPercent null and put the U.G. Total in gValue; never copy a large accumulated U.G. Total such as 1812 into ugPercent. The server will calculate U.G. % as U.G. Total divided by TOTAL L for that row.
- Extract the document's explicitly printed or handwritten grand total liters into totalLiters for both layouts. Do not calculate totalLiters from the extracted rows as a substitute. Use null if the document total is not legible.
- For detailed documents, keep a row if either the producer name, final total, or U.G. value is visible. If the producer name is hard to read, return the best partial transcription or null, include producer in uncertainFields, and still return the row so a human can review it.
- The printed detailed layout can contain two right-side TOTAL / U.G. groups. Read them strictly from left to right as: daily cells, NEAR TOTAL L, NEAR U.G., FINAL TOTAL L, FINAL U.G. The liters field MUST come only from FINAL TOTAL L and gValue MUST come only from FINAL U.G.
- Never substitute NEAR TOTAL L or NEAR U.G. when a FINAL value is unclear. In that situation return null for the unclear final value and add a warning. A missing value is preferable to a value from the wrong column.
- For detailed documents, do not return an empty rows array when populated handwritten rows are visible. Return every visible producer row even when U.G. is blank or null.
- Inspect the complete grid from top to bottom before responding. For standard multi-producer grids, return one output row for every visibly populated producer row; do not stop after the first few rows. Preserve the printed row number so missing rows can be detected during review. For single-producer dated quantity lists, this rule applies to producer totals only, not to each date line.
- When both the original image and an OCR transcription are supplied, use the original image to recover rows or values omitted from the transcription. The transcription is supporting evidence, not a limit on what may be extracted.
- Mandatory check before returning JSON: independently trace every populated detailed-journal row horizontally to the extreme right. Confirm that liters came from the second/final TOTAL L and gValue came from the extreme-right final U.G. Total. Then compare the returned row numbers with every visibly populated producer row and add any omitted rows. Do not claim completion until both checks have been performed.
- For overview documents, extract each populated producer name into producer, liters, and G. value. Put G. in gValue. The collection center belongs in headerCenterName, not in row centerName.
- Exclude TOTAL summary rows. For overview documents, exclude rows whose producer name and numeric values are all empty.
- Romanian decimal commas become JSON decimal points. Never invent illegible values; use null and record uncertainty.
- rawTranscription is concise and warnings describe material ambiguity.`

function contentForFile(file) {
  const encoded = file.buffer.toString('base64')
  if (file.mimetype === 'application/pdf') {
    return {
      type: 'input_file',
      filename: file.originalname,
      file_data: `data:application/pdf;base64,${encoded}`,
      detail: 'high',
    }
  }

  return {
    type: 'input_image',
    image_url: `data:${file.mimetype};base64,${encoded}`,
    detail: 'high',
  }
}

function normalizeMonthlyMilkType(value, fallback = 'MILK-COW') {
  const raw = String(value || fallback || 'MILK-COW').trim()
  const normalized = raw.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase()
  if (/\b(?:BIVOL|BUFFALO|BUFF)\b/u.test(normalized)) return 'MILK-BUFF'
  if (/\b(?:OAIE|OITA|SHEEP)\b/u.test(normalized)) return 'MILK-SHEEP'
  if (/\b(?:CAPRA|GOAT)\b/u.test(normalized)) return 'MILK-GOAT'
  if (/\b(?:VACA|COW)\b/u.test(normalized)) return 'MILK-COW'
  return raw || 'MILK-COW'
}

function normalizeMonthlyText(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Z0-9]+/giu, ' ').trim().toUpperCase()
}

function collapseSingleProducerDailyRows(rows, totalLiters) {
  if (rows.length < 2) return { rows, collapsedCount: 0 }
  const producerNames = rows.map((row) => String(row.producer || '').trim()).filter(Boolean)
  if (!producerNames.length) return { rows, collapsedCount: 0 }
  const producerKey = normalizeMonthlyText(producerNames[0])
  if (!producerKey || producerNames.some((name) => normalizeMonthlyText(name) !== producerKey)) return { rows, collapsedCount: 0 }
  if (!rows.every((row) => row.ugPercent === null && row.gValue === null)) return { rows, collapsedCount: 0 }
  const rowsWithLiters = rows.filter((row) => typeof row.liters === 'number' && Number.isFinite(row.liters))
  if (rowsWithLiters.length < 2) return { rows, collapsedCount: 0 }

  const groups = new Map()
  for (const row of rows) {
    const milkType = normalizeMonthlyMilkType(row.milkType)
    const existing = groups.get(milkType) || {
      ...row,
      rowNumber: groups.size + 1,
      producer: producerNames[0],
      centerName: row.centerName ?? null,
      milkType,
      liters: 0,
      ugPercent: null,
      gValue: null,
      confidence: 1,
      uncertainFields: [],
    }
    existing.liters += typeof row.liters === 'number' && Number.isFinite(row.liters) ? row.liters : 0
    existing.confidence = Math.min(existing.confidence, typeof row.confidence === 'number' ? row.confidence : 0.5)
    existing.uncertainFields = [...new Set([...(existing.uncertainFields || []), ...(row.uncertainFields || [])].filter((field) => !['rowNumber', 'liters'].includes(field)))]
    groups.set(milkType, existing)
  }

  const collapsedRows = [...groups.values()].map((row, index) => ({
    ...row,
    rowNumber: index + 1,
    liters: Number(row.liters.toFixed(3)),
  }))
  if (collapsedRows.length === 1 && typeof totalLiters === 'number' && Number.isFinite(totalLiters)) {
    collapsedRows[0].liters = totalLiters
  }
  return { rows: collapsedRows, collapsedCount: rows.length }
}

export function normalizeMonthlyData(data) {
  if (data.documentType !== 'journal_monthly_settlement') return data
  const currentYear = new Date().getFullYear()
  const identifiedMonth = Number.isInteger(data.documentMonth) && data.documentMonth >= 1 && data.documentMonth <= 12 ? data.documentMonth : null
  const derivedMonthDate = !data.date && identifiedMonth
    ? `${currentYear}-${String(identifiedMonth).padStart(2, '0')}-${String(new Date(currentYear, identifiedMonth, 0).getDate()).padStart(2, '0')}`
    : null
  const missingDate = !data.date && !derivedMonthDate
  let calculatedUgRows = 0
  const headerCenterName = String(data.headerCenterName || '')
    .split(/\b(?:TIP\s*(?:DE\s*)?LAPTE|MILK\s*TYPE)\b/iu, 1)[0]
    .trim()
    .replace(/[\s:;,_-]+$/u, '') || null
  const normalizedHeaderCenter = String(headerCenterName || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Z0-9]+/giu, ' ').trim().toUpperCase()
  const canonicalRows = data.rows.map((row) => data.layoutType === 'overview'
    ? {
        ...row,
        producer: row.centerName || row.producer || null,
        centerName: null,
      }
    : row)
  const sourceRows = canonicalRows.filter((row) => {
    if (data.layoutType !== 'detailed') return true
    const producer = String(row.producer || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Z0-9]+/giu, ' ').trim().toUpperCase()
    if (!producer) return true
    const hasRowValues = row.liters !== null || row.gValue !== null || row.ugPercent !== null
    if (hasRowValues) return true
    const matchesHeader = Boolean(normalizedHeaderCenter && (producer === normalizedHeaderCenter || producer.includes(normalizedHeaderCenter) || normalizedHeaderCenter.includes(producer)))
    const looksLikeHeader = /^(?:PCL|JUD|PCL JUD|CENTRU|CENTER|LUNA|TIP LAPTE)\b/iu.test(producer)
    const looksLikeYear = typeof row.liters === 'number' && row.liters >= 1900 && row.liters <= 2100
    return !(matchesHeader || looksLikeHeader || (looksLikeYear && row.gValue === null && row.ugPercent === null))
  })
  const documentMilkType = normalizeMonthlyMilkType(data.milkType)
  let rows = sourceRows.map((row) => {
    const milkType = normalizeMonthlyMilkType(row.milkType, documentMilkType)
    if (data.layoutType !== 'detailed') return { ...row, milkType }
    let ugPercent = row.ugPercent
    let ugTotal = row.gValue
    if (ugPercent !== null && ugPercent > 20 && ugTotal === null) {
      ugTotal = ugPercent
      ugPercent = null
    }
    if ((ugPercent === null || ugPercent > 20) && row.liters !== null && row.liters > 0 && ugTotal !== null) {
      ugPercent = Number((ugTotal / row.liters).toFixed(3))
      calculatedUgRows += 1
    }
    return { ...row, milkType, ugPercent, gValue: ugTotal }
  })
  const singleProducerCollapse = data.layoutType === 'detailed'
    ? collapseSingleProducerDailyRows(rows, data.totalLiters)
    : { rows, collapsedCount: 0 }
  rows = singleProducerCollapse.rows
  const calculationWarning = calculatedUgRows
    ? [`U.G. % was calculated as U.G. Total divided by TOTAL L for ${calculatedUgRows} row${calculatedUgRows === 1 ? '' : 's'}.`]
    : []
  const collapseWarning = singleProducerCollapse.collapsedCount
    ? [`Single-producer dated quantity entries were collapsed into ${rows.length} milk type total row${rows.length === 1 ? '' : 's'}.`]
    : []
  return {
    ...data,
    headerCenterName,
    date: data.date || derivedMonthDate || new Date().toISOString().slice(0, 10),
    documentMonth: derivedMonthDate ? identifiedMonth : null,
    milkType: documentMilkType,
    totalLiters: data.totalLiters ?? null,
    rows: rows.filter((row) => row.manual || (data.layoutType === 'detailed'
      ? Boolean(row.producer?.trim() || row.liters !== null || row.gValue !== null || row.ugPercent !== null)
      : Boolean(row.producer?.trim() || row.centerName?.trim() || row.liters !== null || row.gValue !== null))),
    warnings: [
      ...data.warnings.filter((warning) => !warning.startsWith('U.G. % was calculated as U.G. Total divided by TOTAL L')),
      ...calculationWarning,
      ...collapseWarning,
      ...(derivedMonthDate ? [`Document month was identified; date was set to the last day of that month in the current year (${derivedMonthDate}).`] : []),
      ...(missingDate ? ['Document date was not found; the current server date was applied.'] : []),
    ],
  }
}

export async function extractMilkCollectionDocument(file, documentCategory = 'daily_routes', settingsOverride = null) {
  const settings = settingsOverride || await getOcrSettings()
  if (settings.provider === 'mistral' && settings.model.startsWith('mistral-ocr-')) return extractWithMistralDocumentAi(file, settings, documentCategory)
  if (settings.provider !== 'openai') return extractWithCompatibleProvider(file, settings, documentCategory)
  const isMonthly = documentCategory === 'journal_monthly_settlement'
  const schema = isMonthly ? MonthlySettlementDocumentSchema : MilkCollectionDocumentSchema
  const prompt = isMonthly ? MONTHLY_SETTLEMENT_PROMPT : EXTRACTION_PROMPT
  const model = settings.model
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await client.responses.parse({
    model,
    store: false,
    reasoning: { effort: 'medium' },
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        contentForFile(file),
      ],
    }],
    text: {
      format: zodTextFormat(schema, isMonthly ? 'monthly_settlement_document' : 'milk_collection_document'),
    },
  })

  if (!response.output_parsed) {
    throw new Error('The OCR model did not return a structured document.')
  }

  const accounting = calculateOpenAiCost(model, response.usage)
  const rawData = isMonthly ? response.output_parsed : prepareDailyRawData(response.output_parsed)
  return {
    data: normalizeMonthlyData(schema.parse(rawData)),
    openai: {
      responseId: response.id,
      model,
      ...accounting,
    },
  }
}

const providerEndpoints = {
  kimi: 'https://api.moonshot.ai/v1/chat/completions',
  deepseek: 'https://api.deepseek.com/chat/completions',
  mistral: 'https://api.mistral.ai/v1/chat/completions',
}

const compatibleProviderTimeoutMs = Math.max(300_000, Number(process.env.COMPATIBLE_OCR_TIMEOUT_MS || 900_000))
const compatibleProviderAgent = new Agent({
  headersTimeout: compatibleProviderTimeoutMs,
  bodyTimeout: compatibleProviderTimeoutMs,
  connectTimeout: 30_000,
})

async function fetchProviderJson(url, options, providerLabel) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), compatibleProviderTimeoutMs)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, dispatcher: compatibleProviderAgent })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${providerLabel} API error: ${payload.error?.message || payload.message || response.statusText}`)
    return payload
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${providerLabel} OCR timed out after ${Math.round(compatibleProviderTimeoutMs / 60_000)} minutes.`)
    if (String(error?.message || '').startsWith(`${providerLabel} API error:`)) throw error
    const detail = error?.cause?.code || error?.cause?.message || error?.message
    throw new Error(`${providerLabel} network request failed${detail ? `: ${detail}` : '.'}`)
  } finally {
    clearTimeout(timeout)
  }
}

function jsonPrompt(documentCategory) {
  if (documentCategory === 'journal_monthly_settlement') {
    return `${MONTHLY_SETTLEMENT_PROMPT}\n\nReturn only valid JSON with this exact shape: {"documentType":"journal_monthly_settlement","layoutType":"detailed"|"overview","date":string|null,"documentMonth":number|null,"milkType":string,"headerCenterName":string|null,"totalLiters":number|null,"rows":[{"rowNumber":number,"producer":string|null,"centerName":string|null,"milkType":string|null,"liters":number|null,"ugPercent":number|null,"gValue":number|null,"confidence":number,"uncertainFields":string[]}],"warnings":string[],"rawTranscription":string}`
  }
  return `${EXTRACTION_PROMPT}\n\nReturn only valid JSON with this exact shape: {"documentType":"daily_driver_statement","companyName":string|null,"date":string|null,"driverName":string|null,"vehicleRegistration":string|null,"route":string|null,"rows":[{"rowNumber":number,"collectionCenter":string|null,"milkType":"MILK-COW"|"MILK-SHEEP"|"MILK-GOAT"|"MILK-BUFF","liters":number|null,"fatPercent":number|null,"density":number|null,"water":number|null,"temperature":number|null,"noticeNumber":string|null,"confidence":number,"uncertainFields":string[]}],"totalLiters":number|null,"warnings":string[],"rawTranscription":string}`
}

function prepareMonthlyRawData(rawData) {
  if (!rawData.milkType) rawData.milkType = 'MILK-COW'
  if (rawData.documentMonth === undefined) rawData.documentMonth = null
  if (rawData.date === undefined) rawData.date = null
  if (rawData.headerCenterName === undefined) rawData.headerCenterName = null
  if (rawData.totalLiters === undefined) rawData.totalLiters = null
  if (!Array.isArray(rawData.warnings)) rawData.warnings = []
  if (typeof rawData.rawTranscription !== 'string') rawData.rawTranscription = ''
  rawData.rows = (Array.isArray(rawData.rows) ? rawData.rows : []).map((row, index) => ({
    ...row,
    rowNumber: Number.isInteger(Number(row.rowNumber)) && Number(row.rowNumber) > 0 ? Number(row.rowNumber) : index + 1,
    producer: row.producer ?? row.centerName ?? null,
    centerName: rawData.layoutType === 'overview' ? null : row.centerName ?? null,
    milkType: row.milkType ?? rawData.milkType ?? 'MILK-COW',
    liters: row.liters ?? row.totalLiters ?? null,
    ugPercent: row.ugPercent ?? null,
    gValue: row.gValue ?? row.ugTotal ?? row.g ?? null,
    confidence: typeof row.confidence === 'number' ? Math.max(0, Math.min(1, row.confidence)) : 0.5,
    uncertainFields: Array.isArray(row.uncertainFields) ? row.uncertainFields : [],
  }))
  return rawData
}

function inferDailyMilkTypeFromFat(fatPercent) {
  const fat = Number(fatPercent)
  if (!Number.isFinite(fat)) return 'MILK-COW'
  if (fat >= 7 && fat <= 8) return 'MILK-BUFF'
  if (fat >= 6 && fat < 7) return 'MILK-SHEEP'
  if (fat >= 3.3 && fat <= 4.5) return 'MILK-COW'
  return 'MILK-COW'
}

function normalizeDailyMilkType(value, fatPercent) {
  const normalized = String(value || '').trim().toUpperCase()
  if (['MILK-COW', 'MILK-SHEEP', 'MILK-GOAT', 'MILK-BUFF'].includes(normalized)) return normalized
  if (['COW', 'VACA', 'LAPTE DE VACA'].includes(normalized)) return 'MILK-COW'
  if (['SHEEP', 'OAIE', 'LAPTE DE OAIE'].includes(normalized)) return 'MILK-SHEEP'
  if (['GOAT', 'CAPRA', 'LAPTE DE CAPRA'].includes(normalized)) return 'MILK-GOAT'
  if (['BUFF', 'BUFFALO', 'BIVOL', 'LAPTE DE BIVOL'].includes(normalized)) return 'MILK-BUFF'
  return inferDailyMilkTypeFromFat(fatPercent)
}

function prepareDailyRawData(rawData) {
  rawData.rows = (Array.isArray(rawData.rows) ? rawData.rows : []).map((row) => ({
    ...row,
    milkType: normalizeDailyMilkType(row.milkType, row.fatPercent),
  }))
  return rawData
}

async function extractWithMistralDocumentAi(file, settings, documentCategory) {
  const provider = OCR_PROVIDERS.mistral
  const apiKey = process.env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('Mistral Document AI is not configured on the server.')
  const startedAt = Date.now()
  const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
  const document = file.mimetype === 'application/pdf'
    ? { type: 'document_url', document_url: dataUrl }
    : { type: 'image_url', image_url: dataUrl }
  const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const ocrPayload = await fetchProviderJson('https://api.mistral.ai/v1/ocr', {
    method: 'POST', headers,
    body: JSON.stringify({
      model: settings.model,
      document,
      table_format: 'html',
      extract_header: true,
      extract_footer: true,
      include_blocks: true,
      confidence_scores_granularity: 'word',
    }),
  }, provider.label)
  const pages = Array.isArray(ocrPayload.pages) ? ocrPayload.pages : []
  const recognisedText = pages.map((page, index) => [
    `--- PAGE ${index + 1} ---`,
    page.header ? `HEADER:\n${page.header}` : '',
    page.markdown || '',
    Array.isArray(page.tables) && page.tables.length ? `TABLES:\n${JSON.stringify(page.tables)}` : '',
    page.footer ? `FOOTER:\n${page.footer}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
  if (!recognisedText.trim()) throw new Error('Mistral Document AI did not recognise any document content.')

  const structuringModel = String(process.env.MISTRAL_STRUCTURING_MODEL || 'mistral-medium-2508').trim()
  const finalColumnCheck = documentCategory === 'journal_monthly_settlement'
    ? '\n\nMANDATORY FINAL-COLUMN CHECK FOR DETAILED JOURNALS: Trace each row horizontally to the extreme right. Ignore the first/near TOTAL L and U.G. group completely. `liters` is the value under the second/final TOTAL L header; `gValue` is the value under the extreme-right final U.G. Total header. If a final cell cannot be read, return null—never copy the nearer value. Before returning JSON, verify this rule independently for every row.'
    : ''
  const structuringPrompt = `${jsonPrompt(documentCategory)}${finalColumnCheck}\n\nCompleteness check: inspect the whole source from the first grid row to the last. Before returning JSON, compare the number of output rows with all visibly populated rows and add any omitted row. Use the original document as the primary source and this OCR transcription as supporting evidence:\n${recognisedText}`
  const structuringContent = file.mimetype === 'application/pdf'
    ? structuringPrompt
    : [{ type: 'text', text: structuringPrompt }, { type: 'image_url', image_url: dataUrl }]
  const structuredPayload = await fetchProviderJson(providerEndpoints.mistral, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: structuringModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: structuringContent }],
    }),
  }, provider.label)
  const text = structuredPayload.choices?.[0]?.message?.content
  if (!text) throw new Error('Mistral did not convert the OCR transcription into review data.')
  const rawData = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/gu, '').trim())
  if (documentCategory === 'journal_monthly_settlement') prepareMonthlyRawData(rawData)
  if (documentCategory !== 'journal_monthly_settlement') prepareDailyRawData(rawData)
  if (documentCategory === 'journal_monthly_settlement' && rawData.layoutType === 'detailed' && file.mimetype !== 'application/pdf') {
    const verification = await verifyMistralFinalColumns(file, rawData, headers, structuringModel)
    const verifiedByRow = new Map(verification.rows.map((row) => [Number(row.rowNumber), row]))
    rawData.rows = (Array.isArray(rawData.rows) ? rawData.rows : []).map((row) => {
      const verified = verifiedByRow.get(Number(row.rowNumber))
      const suspiciousUg = verification.suspiciousUgRows.includes(Number(row.rowNumber))
      return {
        ...row,
        liters: verified?.liters ?? null,
        gValue: verified?.gValue ?? null,
        uncertainFields: [...new Set([
          ...(Array.isArray(row.uncertainFields) ? row.uncertainFields : []),
          ...(!verified ? ['liters', 'gValue'] : []),
          ...(suspiciousUg ? ['gValue'] : []),
        ])],
      }
    })
    rawData.totalLiters = verification.totalLiters ?? null
    rawData.warnings = [
      ...(Array.isArray(rawData.warnings) ? rawData.warnings.filter((warning) => !/near(?:er)? TOTAL|far-right TOTAL|final TOTAL/iu.test(warning)) : []),
      ...(verification.rows.length < rawData.rows.length ? ['Some far-right TOTAL values could not be confirmed by the focused column verification and were left blank.'] : []),
      ...(verification.suspiciousUgRows.length ? [`${verification.suspiciousUgRows.length} far-right U.G. value${verification.suspiciousUgRows.length === 1 ? '' : 's'} differed materially from the document's typical U.G. ratio and must be reviewed.`] : []),
      'Final TOTAL L and U.G. values were checked in a dedicated right-column verification pass.',
    ]
  }
  if (documentCategory === 'journal_monthly_settlement') prepareMonthlyRawData(rawData)
  const schema = documentCategory === 'journal_monthly_settlement' ? MonthlySettlementDocumentSchema : MilkCollectionDocumentSchema
  const data = normalizeMonthlyData(schema.parse(rawData))
  const usage = structuredPayload.usage ? {
    inputTokens: structuredPayload.usage.prompt_tokens || 0,
    cachedInputTokens: structuredPayload.usage.prompt_tokens_details?.cached_tokens || 0,
    outputTokens: structuredPayload.usage.completion_tokens || 0,
    reasoningTokens: structuredPayload.usage.completion_tokens_details?.reasoning_tokens || 0,
    totalTokens: structuredPayload.usage.total_tokens || 0,
    ocrPages: pages.length,
  } : { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0, ocrPages: pages.length }
  return {
    data,
    openai: {
      responseId: structuredPayload.id || null,
      provider: 'mistral',
      model: settings.model,
      structuringModel,
      usage,
      cost: null,
      durationMs: Date.now() - startedAt,
    },
  }
}

async function verifyMistralFinalColumns(file, preliminary, headers, structuringModel) {
  const rotated = await sharp(file.buffer).rotate().toBuffer({ resolveWithObject: true })
  // The repeated totals occupy the far-right edge of this form. Starting at
  // roughly 77% deliberately removes the first TOTAL L column from the crop,
  // so the verifier cannot accidentally select it.
  const cropLeft = Math.floor(rotated.info.width * 0.77)
  const cropWidth = rotated.info.width - cropLeft
  const targetWidth = Math.min(2600, Math.max(cropWidth, cropWidth * 4))
  const crop = await sharp(rotated.data)
    .extract({ left: cropLeft, top: 0, width: cropWidth, height: rotated.info.height })
    .resize({ width: targetWidth })
    .sharpen()
    .jpeg({ quality: 94 })
    .toBuffer()
  const cropDataUrl = `data:image/jpeg;base64,${crop.toString('base64')}`
  const expectedRows = (Array.isArray(preliminary.rows) ? preliminary.rows : []).map((row) => ({ rowNumber: row.rowNumber, producer: row.producer }))
  const prompt = `Verify only the FINAL rightmost totals in this Romanian detailed milk journal.

The supplied image is a tightly cropped and enlarged view of the far-right edge. The earlier/near TOTAL L column has been physically removed and is not present. The remaining handwritten numeric columns read left-to-right as: NEAR U.G. Total (ignore), FINAL TOTAL L (liters), FINAL U.G. Total (gValue).
The table contains two repeated TOTAL/U.G. groups. Reading left to right they are:
1. NEAR TOTAL L — IGNORE
2. NEAR U.G. — IGNORE
3. FINAL TOTAL L — return as liters
4. FINAL U.G. Total at the extreme right — return as gValue

Never copy values from groups 1 or 2. In the tight crop, liters must come from the middle TOTAL/L column and gValue from the rightmost Total column. Trace each producer row horizontally into those two cropped columns. If a final cell is unreadable, return null. Also read the grand total under the FINAL TOTAL L column, not the nearer grand total.

There are exactly ${expectedRows.length} populated producer rows, in this top-to-bottom order: ${JSON.stringify(expectedRows)}
Return exactly ${expectedRows.length} row objects in the same top-to-bottom order. Use position 1 for the first producer row, position 2 for the second, and so on. Do not attempt to find producer names in the crop.

Return only JSON: {"rows":[{"position":number,"liters":number|null,"gValue":number|null}],"totalLiters":number|null}`
  const payload = await fetchProviderJson(providerEndpoints.mistral, {
    method: 'POST', headers,
    body: JSON.stringify({
      model: structuringModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: cropDataUrl },
      ] }],
    }),
  }, 'Mistral final-column verification')
  const text = payload.choices?.[0]?.message?.content
  if (!text) throw new Error('Mistral final-column verification returned no data.')
  const parsed = JSON.parse(String(text).replace(/^```(?:json)?\s*|\s*```$/gu, '').trim())
  const positioned = Array.isArray(parsed.rows) ? parsed.rows : []
  const verifiedRows = positioned.map((row, index) => ({
    rowNumber: expectedRows[Number(row.position || index + 1) - 1]?.rowNumber,
    liters: typeof row.liters === 'number' ? row.liters : null,
    gValue: typeof row.gValue === 'number' ? row.gValue : null,
  })).filter((row) => row.rowNumber !== undefined)
  for (const row of verifiedRows) {
    if (row.liters && row.gValue && row.gValue < row.liters) {
      const scaledRatio = (row.gValue * 10) / row.liters
      if (scaledRatio >= 2.5 && scaledRatio <= 6) row.gValue *= 10
    }
  }
  const totalLiters = typeof parsed.totalLiters === 'number' ? parsed.totalLiters : null
  const ratios = verifiedRows.filter((row) => row.liters > 0 && row.gValue > 0).map((row) => row.gValue / row.liters).filter((ratio) => ratio >= 2.5 && ratio <= 6).sort((a, b) => a - b)
  const medianRatio = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null
  const rowSum = verifiedRows.reduce((sum, row) => sum + (row.liters || 0), 0)
  const totalDifference = totalLiters === null ? 0 : rowSum - totalLiters
  if (medianRatio && Number.isInteger(totalDifference) && Math.abs(totalDifference) <= 2 && totalDifference !== 0) {
    const candidates = verifiedRows.filter((row) => row.liters > totalDifference && row.gValue > 0).map((row) => {
      const adjustedLiters = row.liters - totalDifference
      const improvement = Math.abs(row.gValue / row.liters - medianRatio) - Math.abs(row.gValue / adjustedLiters - medianRatio)
      return { row, adjustedLiters, improvement }
    }).sort((a, b) => b.improvement - a.improvement)
    if (candidates[0]?.improvement > 0.005) candidates[0].row.liters = candidates[0].adjustedLiters
  }
  const suspiciousUgRows = medianRatio ? verifiedRows
    .filter((row) => row.liters > 0 && row.gValue > 0 && Math.abs(row.gValue / row.liters - medianRatio) > 0.03)
    .map((row) => Number(row.rowNumber)) : []
  return {
    rows: verifiedRows,
    totalLiters,
    suspiciousUgRows,
  }
}

async function extractWithCompatibleProvider(file, settings, documentCategory) {
  const provider = OCR_PROVIDERS[settings.provider]
  const apiKey = provider && process.env[provider.keyEnv]
  if (!provider || !apiKey) throw new Error(`${provider?.label || settings.provider} OCR is not configured on the server.`)
  if (file.mimetype === 'application/pdf') throw new Error(`${provider.label} currently supports image uploads in this integration; use OpenAI for PDF documents.`)

  const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
  const imageUrl = settings.provider === 'mistral' ? dataUrl : { url: dataUrl }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), compatibleProviderTimeoutMs)
  let apiResponse
  try {
    apiResponse = await fetch(providerEndpoints[settings.provider], {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      dispatcher: compatibleProviderAgent,
      body: JSON.stringify({
        model: settings.model,
        // Kimi models can enforce a fixed temperature and reject an explicit
        // alternative. Let Kimi apply its model default; keep deterministic
        // temperature 0 for the other compatible providers.
        ...(settings.provider === 'kimi' ? {} : { temperature: 0 }),
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: [{ type: 'text', text: jsonPrompt(documentCategory) }, { type: 'image_url', image_url: imageUrl }] }],
      }),
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`${provider.label} OCR timed out after ${Math.round(compatibleProviderTimeoutMs / 60_000)} minutes.`)
    }
    const detail = error?.cause?.code || error?.cause?.message || error?.message
    throw new Error(`${provider.label} network request failed${detail ? `: ${detail}` : '.'}`)
  } finally {
    clearTimeout(timeout)
  }
  const payload = await apiResponse.json().catch(() => ({}))
  if (!apiResponse.ok) throw new Error(`${provider.label} API error: ${payload.error?.message || apiResponse.statusText}`)
  const text = payload.choices?.[0]?.message?.content
  if (!text) throw new Error(`${provider.label} did not return OCR data.`)
  const cleaned = String(text).replace(/^```(?:json)?\s*|\s*```$/gu, '').trim()
  const schema = documentCategory === 'journal_monthly_settlement' ? MonthlySettlementDocumentSchema : MilkCollectionDocumentSchema
  const rawData = JSON.parse(cleaned)
  if (documentCategory === 'journal_monthly_settlement' && !rawData.milkType) rawData.milkType = 'MILK-COW'
  if (documentCategory === 'journal_monthly_settlement' && rawData.documentMonth === undefined) rawData.documentMonth = null
  if (documentCategory === 'journal_monthly_settlement' && rawData.totalLiters === undefined) rawData.totalLiters = null
  if (documentCategory !== 'journal_monthly_settlement') prepareDailyRawData(rawData)
  const data = normalizeMonthlyData(schema.parse(rawData))
  const usage = payload.usage ? {
    inputTokens: payload.usage.prompt_tokens || 0,
    cachedInputTokens: payload.usage.prompt_tokens_details?.cached_tokens || 0,
    outputTokens: payload.usage.completion_tokens || 0,
    reasoningTokens: payload.usage.completion_tokens_details?.reasoning_tokens || 0,
    totalTokens: payload.usage.total_tokens || 0,
  } : null
  return { data, openai: { responseId: payload.id || null, provider: settings.provider, model: settings.model, usage, cost: null } }
}
