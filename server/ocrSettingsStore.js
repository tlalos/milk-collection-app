import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const settingsDir = path.join(rootDir, 'data', 'settings')
const settingsPath = path.join(settingsDir, 'ocr.json')

export const OCR_PROVIDERS = {
  openai: { label: 'OpenAI', defaultModel: 'gpt-5.6-terra', models: ['gpt-5.6-terra'], keyEnv: 'OPENAI_API_KEY', supportsDocuments: true },
  local: {
    label: 'Local Open Source',
    defaultModel: 'paddleocr-latin-template-v1',
    models: ['paddleocr-latin-template-v1'],
    supportsDocuments: true,
    configurationEnv: 'LOCAL_OCR_URL',
    compatibilityNote: 'Runs PaddleOCR locally without API-token charges. Start the optional Python OCR service before selecting this provider.',
  },
  kimi: { label: 'Kimi', defaultModel: 'kimi-k2.6', models: ['kimi-k2.6', 'kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed'], keyEnv: 'KIMI_API_KEY', supportsDocuments: false },
  deepseek: {
    label: 'DeepSeek',
    defaultModel: 'deepseek-v4-flash-vision-exp',
    models: ['deepseek-v4-flash-vision-exp'],
    keyEnv: 'DEEPSEEK_API_KEY',
    supportsDocuments: false,
    compatibilityNote: 'Uses the experimental DeepSeek vision model for images. PDF uploads are not supported by this integration.',
  },
  mistral: {
    label: 'Mistral Document AI',
    defaultModel: 'mistral-ocr-latest',
    models: ['mistral-ocr-latest', 'mistral-ocr-4-1', 'mistral-ocr-4-0', 'mistral-ocr-2512'],
    keyEnv: 'MISTRAL_API_KEY',
    supportsDocuments: true,
    compatibilityNote: 'Uses Mistral Document AI OCR for images/PDFs, then converts the recognised document into the application review schema.',
  },
}

export function isOcrProviderConfigured(provider) {
  if (!provider) return false
  if (provider.configurationEnv) return Boolean(process.env[provider.configurationEnv])
  return Boolean(provider.keyEnv && process.env[provider.keyEnv])
}

function defaults() {
  return { provider: 'openai', model: process.env.OPENAI_OCR_MODEL || OCR_PROVIDERS.openai.defaultModel, updatedAt: null }
}

export async function initializeOcrSettingsStore() {
  await mkdir(settingsDir, { recursive: true })
  try { await readFile(settingsPath, 'utf8') } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    await writeFile(settingsPath, JSON.stringify(defaults(), null, 2), 'utf8')
  }
}

export async function getOcrSettings() {
  try {
    const saved = JSON.parse(await readFile(settingsPath, 'utf8'))
    const definition = OCR_PROVIDERS[saved.provider]
    if (!definition) return defaults()
    return {
      ...defaults(), ...saved,
      model: definition.models.includes(saved.model) ? saved.model : definition.defaultModel,
    }
  } catch { return defaults() }
}

export async function saveOcrSettings(provider, model) {
  const definition = OCR_PROVIDERS[provider]
  if (!definition) throw new Error('Unsupported OCR provider.')
  if (!definition.models.includes(model)) throw new Error('Unsupported OCR model for this provider.')
  const settings = { provider, model, updatedAt: new Date().toISOString() }
  const temporary = `${settingsPath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, JSON.stringify(settings, null, 2), 'utf8')
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try { await rename(temporary, settingsPath); return settings } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') throw error
      await new Promise((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
    }
  }
  await copyFile(temporary, settingsPath)
  await rm(temporary, { force: true })
  return settings
}

export function publicOcrSettings(settings) {
  return {
    ...settings,
    providers: Object.entries(OCR_PROVIDERS).map(([id, provider]) => ({
      id, label: provider.label, models: provider.models,
      configured: isOcrProviderConfigured(provider),
      supportsDocuments: provider.supportsDocuments,
      compatibilityNote: provider.compatibilityNote || null,
      local: id === 'local',
    })),
  }
}
