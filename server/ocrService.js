import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { MilkCollectionDocumentSchema } from './ocrSchema.js'
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

export async function extractMilkCollectionDocument(file) {
  const settings = await getOcrSettings()
  if (settings.provider !== 'openai') return extractWithCompatibleProvider(file, settings)
  const model = settings.model
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const response = await client.responses.parse({
    model,
    store: false,
    reasoning: { effort: 'medium' },
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: EXTRACTION_PROMPT },
        contentForFile(file),
      ],
    }],
    text: {
      format: zodTextFormat(MilkCollectionDocumentSchema, 'milk_collection_document'),
    },
  })

  if (!response.output_parsed) {
    throw new Error('The OCR model did not return a structured document.')
  }

  const accounting = calculateOpenAiCost(model, response.usage)
  return {
    data: MilkCollectionDocumentSchema.parse(response.output_parsed),
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

function jsonPrompt() {
  return `${EXTRACTION_PROMPT}\n\nReturn only valid JSON with this exact shape: {"documentType":"daily_driver_statement","companyName":string|null,"date":string|null,"driverName":string|null,"vehicleRegistration":string|null,"route":string|null,"rows":[{"rowNumber":number,"collectionCenter":string|null,"liters":number|null,"fatPercent":number|null,"density":number|null,"water":number|null,"temperature":number|null,"noticeNumber":string|null,"confidence":number,"uncertainFields":string[]}],"totalLiters":number|null,"warnings":string[],"rawTranscription":string}`
}

async function extractWithCompatibleProvider(file, settings) {
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
      messages: [{ role: 'user', content: [{ type: 'text', text: jsonPrompt() }, { type: 'image_url', image_url: imageUrl }] }],
    }),
  })
  const payload = await apiResponse.json().catch(() => ({}))
  if (!apiResponse.ok) throw new Error(`${provider.label} API error: ${payload.error?.message || apiResponse.statusText}`)
  const text = payload.choices?.[0]?.message?.content
  if (!text) throw new Error(`${provider.label} did not return OCR data.`)
  const cleaned = String(text).replace(/^```(?:json)?\s*|\s*```$/gu, '').trim()
  const data = MilkCollectionDocumentSchema.parse(JSON.parse(cleaned))
  const usage = payload.usage ? {
    inputTokens: payload.usage.prompt_tokens || 0,
    cachedInputTokens: payload.usage.prompt_tokens_details?.cached_tokens || 0,
    outputTokens: payload.usage.completion_tokens || 0,
    reasoningTokens: payload.usage.completion_tokens_details?.reasoning_tokens || 0,
    totalTokens: payload.usage.total_tokens || 0,
  } : null
  return { data, openai: { responseId: payload.id || null, provider: settings.provider, model: settings.model, usage, cost: null } }
}
