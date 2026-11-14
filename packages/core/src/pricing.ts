import type { UnifiedTurnUsage } from './types.js';

/** Prices in USD per 1M tokens */
export interface ModelPrice {
  inputPer1M: number;
  cachedInputPer1M: number;
  outputPer1M: number;
}

export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Anthropic Claude 4.x
  'claude-sonnet-4-5': { inputPer1M: 3.0, cachedInputPer1M: 0.3, outputPer1M: 15.0 },
  'claude-opus-4-1': { inputPer1M: 15.0, cachedInputPer1M: 1.5, outputPer1M: 75.0 },
  'claude-haiku-4-5': { inputPer1M: 0.8, cachedInputPer1M: 0.08, outputPer1M: 4.0 },
  // OpenAI GPT-5 / Codex / o3
  'gpt-5': { inputPer1M: 2.5, cachedInputPer1M: 0.625, outputPer1M: 10.0 },
  'gpt-5-codex': { inputPer1M: 2.5, cachedInputPer1M: 0.625, outputPer1M: 10.0 },
  'o3': { inputPer1M: 2.0, cachedInputPer1M: 0.5, outputPer1M: 8.0 },
  // DeepSeek V3 / R1
  'deepseek-chat': { inputPer1M: 0.27, cachedInputPer1M: 0.07, outputPer1M: 1.1 },
  'deepseek-reasoner': { inputPer1M: 0.55, cachedInputPer1M: 0.14, outputPer1M: 2.19 },
  // Zhipu GLM
  'glm-5': { inputPer1M: 0.5, cachedInputPer1M: 0.1, outputPer1M: 2.0 },
  'glm-4.5': { inputPer1M: 0.4, cachedInputPer1M: 0.1, outputPer1M: 1.6 },
  // Google Gemini
  'gemini-2.5-pro': { inputPer1M: 1.25, cachedInputPer1M: 0.31, outputPer1M: 10.0 },
  'gemini-2.5-flash': { inputPer1M: 0.15, cachedInputPer1M: 0.0375, outputPer1M: 0.6 },
};

const FALLBACK_PRICE: ModelPrice = {
  inputPer1M: 2.0,
  cachedInputPer1M: 0.5,
  outputPer1M: 8.0,
};

export interface TurnCostBreakdown {
  modelMatched: string;
  inputCostUsd: number;
  cachedCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  /** USD saved by prompt caching compared to uncached input pricing */
  cacheSavingsUsd: number;
}

export function resolveModelPrice(model?: string): { key: string; price: ModelPrice } {
  if (!model) return { key: 'default', price: FALLBACK_PRICE };
  const normalized = model.toLowerCase();
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (normalized.includes(key)) return { key, price };
  }
  return { key: 'default', price: FALLBACK_PRICE };
}

export function calculateTurnCost(turn: UnifiedTurnUsage): TurnCostBreakdown {
  const { key, price } = resolveModelPrice(turn.model);
  const billableOutput = turn.outputTokens + turn.reasoningTokens;

  const inputCostUsd = (turn.inputTokens / 1_000_000) * price.inputPer1M;
  const cachedCostUsd = (turn.cachedTokens / 1_000_000) * price.cachedInputPer1M;
  const outputCostUsd = (billableOutput / 1_000_000) * price.outputPer1M;
  const totalCostUsd = inputCostUsd + cachedCostUsd + outputCostUsd;

  const uncachedEquivalent = (turn.cachedTokens / 1_000_000) * price.inputPer1M;
  const cacheSavingsUsd = Math.max(0, uncachedEquivalent - cachedCostUsd);

  return {
    modelMatched: key,
    inputCostUsd,
    cachedCostUsd,
    outputCostUsd,
    totalCostUsd,
    cacheSavingsUsd,
  };
}
