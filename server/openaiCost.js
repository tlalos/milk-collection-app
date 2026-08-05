const MODEL_PRICING = {
  'gpt-5.6-terra': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.6-sol': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.6': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.6-luna': { input: 1, cachedInput: 0.1, output: 6 },
}

const PRICING_DATE = '2026-08-03'

export function calculateOpenAiCost(model, usage) {
  const rates = MODEL_PRICING[model]
  if (!usage) return { usage: null, cost: null }

  const inputTokens = usage.input_tokens ?? 0
  const cachedInputTokens = usage.input_tokens_details?.cached_tokens ?? 0
  const outputTokens = usage.output_tokens ?? 0
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens)
  const normalizedUsage = {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
    totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
  }

  if (!rates) return { usage: normalizedUsage, cost: null }

  const estimatedUsd = (
    uncachedInputTokens * rates.input
    + cachedInputTokens * rates.cachedInput
    + outputTokens * rates.output
  ) / 1_000_000

  return {
    usage: normalizedUsage,
    cost: {
      currency: 'USD',
      estimatedUsd: Number(estimatedUsd.toFixed(8)),
      model,
      pricingDate: PRICING_DATE,
      ratesPerMillionTokens: {
        input: rates.input,
        cachedInput: rates.cachedInput,
        output: rates.output,
      },
    },
  }
}
