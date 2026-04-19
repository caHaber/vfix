import type { ModelID, ModelPricing } from './types.js';

/** Hardcoded model pricing (per 1M tokens, USD) */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': {
    inputPer1M: 2.50,
    outputPer1M: 10.00,
    contextWindow: 128_000,
    tokenizer: 'o200k_base',
  },
  'gpt-4o-mini': {
    inputPer1M: 0.15,
    outputPer1M: 0.60,
    contextWindow: 128_000,
    tokenizer: 'o200k_base',
  },
  'gpt-4-turbo': {
    inputPer1M: 10.00,
    outputPer1M: 30.00,
    contextWindow: 128_000,
    tokenizer: 'cl100k_base',
  },
  'gpt-3.5-turbo': {
    inputPer1M: 0.50,
    outputPer1M: 1.50,
    contextWindow: 16_385,
    tokenizer: 'cl100k_base',
  },
  'claude-opus-4-20250514': {
    inputPer1M: 15.00,
    outputPer1M: 75.00,
    contextWindow: 200_000,
    tokenizer: 'cl100k_base',
  },
  'claude-sonnet-4-20250514': {
    inputPer1M: 3.00,
    outputPer1M: 15.00,
    contextWindow: 200_000,
    tokenizer: 'cl100k_base',
  },
  'claude-haiku-4-20250414': {
    inputPer1M: 0.80,
    outputPer1M: 4.00,
    contextWindow: 200_000,
    tokenizer: 'cl100k_base',
  },
};

export function getModelPricing(model: ModelID): ModelPricing | undefined {
  return MODEL_PRICING[model];
}
