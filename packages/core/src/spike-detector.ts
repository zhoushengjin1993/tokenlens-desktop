import type { UnifiedTurnUsage } from './types.js';

export interface SpikeThresholdConfig {
  inputThreshold?: number;
  totalThreshold?: number;
  cacheMissMinInput?: number;
}

export interface SpikeAlertResult {
  isSpike: boolean;
  severity: 'none' | 'warning' | 'critical';
  reasons: string[];
}

export function detectTokenSpike(
  turn: UnifiedTurnUsage,
  config: SpikeThresholdConfig = {},
): SpikeAlertResult {
  const inputThreshold = config.inputThreshold ?? 50_000;
  const totalThreshold = config.totalThreshold ?? 80_000;
  const cacheMissMinInput = config.cacheMissMinInput ?? 15_000;

  const reasons: string[] = [];

  if (turn.inputTokens >= inputThreshold) {
    reasons.push(`单轮输入突破 ${(inputThreshold / 1000).toFixed(0)}k`);
  }
  if (turn.totalTokens >= totalThreshold) {
    reasons.push(`单轮总 Token 突破 ${(totalThreshold / 1000).toFixed(0)}k`);
  }
  if (turn.inputTokens >= cacheMissMinInput && turn.cachedTokens === 0) {
    reasons.push('高输入且缓存未命中，建议 /compact 或新开会话');
  }

  return {
    isSpike: reasons.length > 0,
    severity: turn.inputTokens >= inputThreshold * 1.5 ? 'critical' : reasons.length > 0 ? 'warning' : 'none',
    reasons,
  };
}
