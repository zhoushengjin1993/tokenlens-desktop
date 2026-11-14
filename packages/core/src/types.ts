export type ClientType = 'codex' | 'zcode' | 'claude' | 'dsh' | 'antigravity';

export type TurnStatus = 'running' | 'completed' | 'incomplete';

export type UsageAccuracy = 'exact' | 'estimated';

export type SourceMode = 'desktop' | 'cli' | 'unknown';

export interface ToolCallSummary {
  callId: string;
  name: string;
  durationMs?: number;
  status: 'running' | 'completed' | 'error';
}

export interface SubAgentCall {
  id: string;
  agentName?: string;
  role?: string;
  promptSummary?: string;
  inputTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs?: number;
  status: TurnStatus;
}

export interface UnifiedTurnUsage {
  client: ClientType;
  sessionId: string;
  sessionTitle?: string;
  sourceMode?: SourceMode;
  turnId: string;
  turnIndex: number;
  model?: string;
  promptSummary: string;
  inputTokens: number;
  cachedTokens: number;
  cacheCreationTokens?: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens: number;
  durationMs: number;
  startedAt: number;
  updatedAt: number;
  status: TurnStatus;
  usageAccuracy: UsageAccuracy;
  compacted?: boolean;
  subAgentCalls: SubAgentCall[];
  toolCalls?: ToolCallSummary[];
}

export interface TokenMetrics {
  inputTokens: number;
  cachedTokens: number;
  cacheCreationTokens?: number;
  reasoningTokens: number;
  outputTokens: number;
  totalTokens?: number;
}

/**
 * Raw turn fragment emitted by an adapter before deduplication and aggregation.
 */
export interface RawTurnFragment {
  client: ClientType;
  sessionId: string;
  sessionTitle?: string;
  sourceMode?: SourceMode;
  turnId: string;
  /** Used to deduplicate streaming snapshots of the same message */
  messageId?: string;
  /** 'snapshot' replaces metrics for messageId; 'delta' adds; 'cumulative' computes diff from session baseline */
  accountingMode: 'snapshot' | 'delta' | 'cumulative';
  model?: string;
  promptSummary?: string;
  metrics: TokenMetrics;
  startedAt?: number;
  updatedAt: number;
  durationMs?: number;
  status?: TurnStatus;
  usageAccuracy?: UsageAccuracy;
  compacted?: boolean;
  toolCalls?: ToolCallSummary[];
  /** If set, this fragment belongs to a sub-agent invoked by parentTurnId */
  parentTurnId?: string;
  subAgentMeta?: {
    id: string;
    agentName?: string;
    role?: string;
    promptSummary?: string;
  };
}

export interface AdapterHealth {
  client: ClientType;
  available: boolean;
  detectedPaths: string[];
  errors: string[];
  checkedAt: number;
}

export interface AdapterOptions {
  /** Override default root paths (useful for tests & simulator) */
  watchPaths?: string[];
  /** Polling interval in ms for SQLite or fallback checks */
  pollIntervalMs?: number;
}
