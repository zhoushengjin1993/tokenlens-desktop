import type { ClientType } from '@tokenlens/core';

export const CLIENT_LABELS: Record<ClientType, string> = {
  codex: 'Codex',
  zcode: 'Zcode',
  claude: 'Claude',
  dsh: 'DSH',
  antigravity: 'Antigravity',
  cursor: 'Cursor',
};

export const ALL_CLIENTS: ClientType[] = [
  'codex',
  'zcode',
  'claude',
  'dsh',
  'antigravity',
  'cursor',
];

export function formatTokens(n: number, estimated = false): string {
  const prefix = estimated ? '≈' : '';
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}k`;
  return `${prefix}${n}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
