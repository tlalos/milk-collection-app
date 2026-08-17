import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { MilkCollectionDocumentSchema, MonthlySettlementDocumentSchema } from './ocrSchema.js'
import { calculateOpenAiCost } from './openaiCost.js'
import { getOcrSettings, OCR_PROVIDERS } from './ocrSettingsStore.js'

const EXTRACTION_PROMPT = `Extract this Romanian milk-collection daily driver statement into the supplied schema.

Rules:
- Read printed and handwritten text. Preserve Romanian names as written; do not translate them.
- Dates must be returned as YYYY-MM-DD only when unambiguous. Otherwise return null and explain in warnings.
- Extract only non-empty collection rows. Keep their printed row numbers.
- Column meanings: collection center name, liters, fat percentage (Gr %), density/U.G., water/APA, temperature/TEMP, notice number/AVIZ.
- Romanian decimal commas are decimal points in JSON numbers (for example 3,8 becomes 3.8).
- Do not infer illegible values. Use null, add the field name to uncertainFields, and describe significant ambiguity in warnings.
- confidence is an estimate from 0 to 1 for each entire row.
- totalLiters must be the handwritten total when clearly visible. Do not calculate it as a substitute. Mention disagreement with the row sum in warnings.
- rawTranscription should contain a concise line-by-line transcription of all populated handwritten fields.
- Signatures are not data fields and must not be identified.`

const MONTHLY_SETTLEMENT_PROMPT = `Extract this Romanian milk collection JOURNAL MONTHLY SETTLEMENT document.

First identify the layout:
- detailed: a wide handwritten daily grid with producer names in the first column, day columns, and final TOTAL / U.G. columns.
- overview: a printed summary grid with center/producer name, liters, G. and U.G. columns.

Rules:
- Preserve Romanian names as written and return dates as YYYY-MM-DD when they can be determined.
- Detect the milk type from the header (for example VACA). If no milk type is visible, return VACA.
- For detailed documents, headerCenterName is the collection center written above the grid on the left. For each populated producer row extract the producer, the LAST total column, and the U.G. percentage/value beside that final total. Do not extract intermediate daily cells.
- For overview documents, extract each populated center name, liters, and G. value. Put G. in gValue.
- Exclude TOTAL rows and exclude any data row whose relevant name (producer for detailed, centerName for overview) is empty.
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
    detail: 'original',
  }
}

function normalizeMonthlyData(data) {
  if (data.documentType !== 'journal_monthly_settlement') return data
  const missingDate = !data.date
  return {
    ...data,
    date: data.date || new Date().toISOString().slice(0, 10),
    milkType: data.milkType?.trim() || 'VACA',
    rows: data.rows.filter((row) => data.layoutType === 'detailed'
      ? Boolean(row.producer?.trim())
      : Boolean(row.centerName?.trim())),
    warnings: missingDate
      ? [...data.warnings, 'Document date was not found; the current server date was applied.']
      : data.warnings,
  }
}

export async function extractMilkCollectionDocument(file, documentCategory = 'daily_routes') {
  const settings = await getOcrSettings()
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
  return {
    data: normalizeMonthlyData(schema.parse(response.output_parsed)),
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

function jsonPrompt(documentCategory) {
  if (documentCategory === 'journal_monthly_settlement') {
    return `${MONTHLY_SETTLEMENT_PROMPT}\n\nReturn only valid JSON with this exact shape: {"documentType":"journal_monthly_settlement","layoutType":"detailed"|"overview","date":string|null,"milkType":string,"headerCenterName":string|null,"rows":[{"rowNumber":number,"producer":string|null,"centerName":string|null,"liters":number|null,"ugPercent":number|null,"gValue":number|null,"confidence":number,"uncertainFields":string[]}],"warnings":string[],"rawTranscription":string}`
  }
  return `${EXTRACTION_PROMPT}\n\nReturn only valid JSON with this exact shape: {"documentType":"daily_driver_statement","companyName":string|null,"date":string|null,"driverName":string|null,"vehicleRegistration":string|null,"route":string|null,"rows":[{"rowNumber":number,"collectionCenter":string|null,"liters":number|null,"fatPercent":number|null,"density":number|null,"water":number|null,"temperature":number|null,"noticeNumber":string|null,"confidence":number,"uncertainFields":string[]}],"totalLiters":number|null,"warnings":string[],"rawTranscription":string}`
}

async function extractWithCompatibleProvider(file, settings, documentCategory) {
  const provider = OCR_PROVIDERS[settings.provider]
  const apiKey = provider && process.env[provider.keyEnv]
  if (!provider || !apiKey) throw new Error(`${provider?.label || settings.provider} OCR is not configured on the server.`)
  if (settings.provider === 'deepseek') throw new Error('DeepSeek is selectable, but its official API does not currently document image/PDF input for this OCR workflow. Choose OpenAI, Kimi, or Mistral.')
  if (file.mimetype === 'application/pdf') throw new Error(`${provider.label} currently supports image uploads in this integration; use OpenAI for PDF documents.`)

  const dataUrl = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`
  const imageUrl = settings.provider === 'mistral' ? dataUrl : { url: dataUrl }
  const apiResponse = await fetch(providerEndpoints[settings.provider], {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: [{ type: 'text', text: jsonPrompt(documentCategory) }, { type: 'image_url', image_url: imageUrl }] }],
    }),
  })
  const payload = await apiResponse.json().catch(() => ({}))
  if (!apiResponse.ok) throw new Error(`${provider.label} API error: ${payload.error?.message || apiResponse.statusText}`)
  const text = payload.choices?.[0]?.message?.content
  if (!text) throw new Error(`${provider.label} did not return OCR data.`)
  const cleaned = String(text).replace(/^```(?:json)?\s*|\s*```$/gu, '').trim()
  const schema = documentCategory === 'journal_monthly_settlement' ? MonthlySettlementDocumentSchema : MilkCollectionDocumentSchema
  const rawData = JSON.parse(cleaned)
  if (documentCategory === 'journal_monthly_settlement' && !rawData.milkType) rawData.milkType = 'VACA'
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
