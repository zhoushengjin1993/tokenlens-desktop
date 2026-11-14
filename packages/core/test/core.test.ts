import { describe, expect, it } from 'vitest';
import { calculateTurnCost, detectTokenSpike, type UnifiedTurnUsage } from '../src/index.js';

function makeTurn(overrides: Partial<UnifiedTurnUsage> = {}): UnifiedTurnUsage {
  return {
    client: 'claude',
    sessionId: 's1',
    turnId: 't1',
    turnIndex: 1,
    model: 'claude-sonnet-4-5',
    promptSummary: 'Test prompt',
    inputTokens: 2000,
    cachedTokens: 20000,
    reasoningTokens: 0,
    outputTokens: 500,
    totalTokens: 2500,
    durationMs: 1200,
    startedAt: 1000,
    updatedAt: 2200,
    status: 'completed',
    usageAccuracy: 'exact',
    subAgentCalls: [],
    ...overrides,
  };
}

describe('Core pricing & spike detection', () => {
  it('calculates turn cost and prompt cache savings accurately', () => {
    const cost = calculateTurnCost(makeTurn());
    expect(cost.modelMatched).toBe('claude-sonnet-4-5');
    // 20k cached at $0.30/1M = $0.006 vs $3.00/1M = $0.06 -> saved $0.054
    expect(cost.cacheSavingsUsd).toBeCloseTo(0.054, 5);
    expect(cost.totalCostUsd).toBeGreaterThan(0);
  });

  it('detects token spike and cache-miss alerts', () => {
    const normal = detectTokenSpike(makeTurn());
    expect(normal.isSpike).toBe(false);

    const spike = detectTokenSpike(makeTurn({ inputTokens: 55_000, cachedTokens: 0 }));
    expect(spike.isSpike).toBe(true);
    expect(spike.reasons.length).toBeGreaterThanOrEqual(2);
  });
});
