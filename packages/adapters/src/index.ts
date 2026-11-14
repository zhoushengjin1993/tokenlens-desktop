import type { AdapterOptions, BaseLogAdapter, ClientType } from '@tokenlens/core';
import { CodexAdapter } from './codex.js';
import { ZcodeAdapter } from './zcode.js';
import { ClaudeAdapter } from './claude.js';
import { DshAdapter } from './dsh.js';
import { AntigravityAdapter } from './antigravity.js';

export { CodexAdapter } from './codex.js';
export { ZcodeAdapter } from './zcode.js';
export { ClaudeAdapter } from './claude.js';
export { DshAdapter } from './dsh.js';
export { AntigravityAdapter } from './antigravity.js';
export { ByteOffsetTailer } from './utils/jsonl-tail.js';

export function createAdapter(client: ClientType, options?: AdapterOptions): BaseLogAdapter {
  switch (client) {
    case 'codex':
      return new CodexAdapter(options);
    case 'zcode':
      return new ZcodeAdapter(options);
    case 'claude':
      return new ClaudeAdapter(options);
    case 'dsh':
      return new DshAdapter(options);
    case 'antigravity':
      return new AntigravityAdapter(options);
  }
}

export function createAllAdapters(
  overrides: Partial<Record<ClientType, AdapterOptions>> = {},
): BaseLogAdapter[] {
  const clients: ClientType[] = ['codex', 'zcode', 'claude', 'dsh', 'antigravity'];
  return clients.map((c) => createAdapter(c, overrides[c]));
}
