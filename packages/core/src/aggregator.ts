import type {
  ClientType,
  RawTurnFragment,
  SubAgentCall,
  TokenMetrics,
  ToolCallSummary,
  UnifiedTurnUsage,
} from './types.js';

interface TurnState {
  turn: UnifiedTurnUsage;
  /** messageId -> latest snapshot metrics for deduplication */
  messageSnapshots: Map<string, TokenMetrics>;
  /** accumulated delta metrics (for fragments without messageId or delta mode) */
  deltaMetrics: TokenMetrics;
  /** toolCallId -> ToolCallSummary */
  toolCallMap: Map<string, ToolCallSummary>;
  /** subAgentId -> SubAgentCall */
  subAgentMap: Map<string, SubAgentCall>;
}

interface SessionState {
  turns: Map<string, TurnState>;
  turnOrder: string[];
  lastCumulative?: TokenMetrics;
  lastCumulativeTurnId?: string;
}

function emptyMetrics(): TokenMetrics {
  return {
    inputTokens: 0,
    cachedTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function addMetrics(a: TokenMetrics, b: TokenMetrics): TokenMetrics {
  const inputTokens = a.inputTokens + b.inputTokens;
  const cachedTokens = a.cachedTokens + b.cachedTokens;
  const cacheCreationTokens = (a.cacheCreationTokens ?? 0) + (b.cacheCreationTokens ?? 0);
  const reasoningTokens = a.reasoningTokens + b.reasoningTokens;
  const outputTokens = a.outputTokens + b.outputTokens;
  return {
    inputTokens,
    cachedTokens,
    cacheCreationTokens,
    reasoningTokens,
    outputTokens,
    totalTokens:
      a.totalTokens !== undefined && b.totalTokens !== undefined
        ? a.totalTokens + b.totalTokens
        : inputTokens + outputTokens,
  };
}

export class TurnAggregator {
  private readonly sessions = new Map<string, SessionState>();

  private sessionKey(client: ClientType, sessionId: string): string {
    return `${client}::${sessionId}`;
  }

  private getOrCreateSession(client: ClientType, sessionId: string): SessionState {
    const key = this.sessionKey(client, sessionId);
    let session = this.sessions.get(key);
    if (!session) {
      session = { turns: new Map(), turnOrder: [] };
      this.sessions.set(key, session);
    }
    return session;
  }

  /**
   * Ingest a raw turn fragment, deduplicating by messageId, normalizing
   * cumulative/delta accounting, and merging sub-agent calls.
   */
  ingest(fragment: RawTurnFragment): UnifiedTurnUsage {
    if (fragment.parentTurnId && fragment.subAgentMeta) {
      return this.ingestSubAgent(fragment);
    }

    const session = this.getOrCreateSession(fragment.client, fragment.sessionId);
    let state = session.turns.get(fragment.turnId);

    if (!state) {
      const turnIndex = session.turnOrder.length + 1;
      const startedAt = fragment.startedAt ?? fragment.updatedAt;
      state = {
        turn: {
          client: fragment.client,
          sessionId: fragment.sessionId,
          sessionTitle: fragment.sessionTitle,
          sourceMode: fragment.sourceMode ?? 'unknown',
          turnId: fragment.turnId,
          turnIndex,
          model: fragment.model,
          promptSummary: fragment.promptSummary ?? '',
          inputTokens: 0,
          cachedTokens: 0,
          cacheCreationTokens: 0,
          reasoningTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          durationMs: fragment.durationMs ?? 0,
          startedAt,
          updatedAt: fragment.updatedAt,
          status: fragment.status ?? 'running',
          usageAccuracy: fragment.usageAccuracy ?? 'exact',
          compacted: fragment.compacted ?? false,
          subAgentCalls: [],
          toolCalls: [],
        },
        messageSnapshots: new Map(),
        deltaMetrics: emptyMetrics(),
        toolCallMap: new Map(),
        subAgentMap: new Map(),
      };
      session.turns.set(fragment.turnId, state);
      session.turnOrder.push(fragment.turnId);
    }

    const turn = state.turn;
    if (fragment.sessionTitle) turn.sessionTitle = fragment.sessionTitle;
    if (fragment.sourceMode && fragment.sourceMode !== 'unknown') turn.sourceMode = fragment.sourceMode;
    if (fragment.model) turn.model = fragment.model;
    if (fragment.promptSummary && !turn.promptSummary) turn.promptSummary = fragment.promptSummary;
    if (fragment.compacted) turn.compacted = true;
    if (fragment.usageAccuracy) turn.usageAccuracy = fragment.usageAccuracy;
    if (fragment.startedAt && fragment.startedAt < turn.startedAt) {
      turn.startedAt = fragment.startedAt;
    }
    if (fragment.updatedAt > turn.updatedAt) {
      turn.updatedAt = fragment.updatedAt;
    }
    if (fragment.durationMs !== undefined) {
      turn.durationMs = fragment.durationMs;
    } else if (turn.updatedAt >= turn.startedAt) {
      turn.durationMs = turn.updatedAt - turn.startedAt;
    }
    if (fragment.status) {
      turn.status = fragment.status;
    }

    if (fragment.toolCalls) {
      for (const tc of fragment.toolCalls) {
        state.toolCallMap.set(tc.callId, tc);
      }
      turn.toolCalls = Array.from(state.toolCallMap.values());
    }

    // Apply token metrics according to accounting mode
    if (fragment.accountingMode === 'snapshot') {
      const msgKey = fragment.messageId ?? `__turn_${fragment.turnId}`;
      state.messageSnapshots.set(msgKey, fragment.metrics);
    } else if (fragment.accountingMode === 'delta') {
      if (fragment.messageId) {
        state.messageSnapshots.set(fragment.messageId, fragment.metrics);
      } else {
        state.deltaMetrics = addMetrics(state.deltaMetrics, fragment.metrics);
      }
    } else if (fragment.accountingMode === 'cumulative') {
      const prev = session.lastCumulative;
      const delta: TokenMetrics = prev
        ? {
            inputTokens: Math.max(0, fragment.metrics.inputTokens - prev.inputTokens),
            cachedTokens: Math.max(0, fragment.metrics.cachedTokens - prev.cachedTokens),
            cacheCreationTokens: Math.max(
              0,
              (fragment.metrics.cacheCreationTokens ?? 0) - (prev.cacheCreationTokens ?? 0),
            ),
            reasoningTokens: Math.max(0, fragment.metrics.reasoningTokens - prev.reasoningTokens),
            outputTokens: Math.max(0, fragment.metrics.outputTokens - prev.outputTokens),
            totalTokens:
              fragment.metrics.totalTokens !== undefined && prev.totalTokens !== undefined
                ? Math.max(0, fragment.metrics.totalTokens - prev.totalTokens)
                : undefined,
          }
        : fragment.metrics;
      session.lastCumulative = fragment.metrics;
      session.lastCumulativeTurnId = fragment.turnId;
      state.deltaMetrics = addMetrics(state.deltaMetrics, delta);
    }

    // Recompute turn totals from snapshots + deltaMetrics
    let totals = { ...state.deltaMetrics };
    for (const snap of state.messageSnapshots.values()) {
      totals = addMetrics(totals, snap);
    }

    turn.inputTokens = totals.inputTokens;
    turn.cachedTokens = totals.cachedTokens;
    turn.cacheCreationTokens = totals.cacheCreationTokens;
    turn.reasoningTokens = totals.reasoningTokens;
    turn.outputTokens = totals.outputTokens;
    turn.totalTokens =
      totals.totalTokens && totals.totalTokens > 0
        ? totals.totalTokens
        : totals.inputTokens + totals.outputTokens;

    return { ...turn, subAgentCalls: [...turn.subAgentCalls], toolCalls: turn.toolCalls ? [...turn.toolCalls] : [] };
  }

  private ingestSubAgent(fragment: RawTurnFragment): UnifiedTurnUsage {
    const parentTurnId = fragment.parentTurnId!;
    const meta = fragment.subAgentMeta!;
    const session = this.getOrCreateSession(fragment.client, fragment.sessionId);

    // Ensure parent turn exists
    if (!session.turns.has(parentTurnId)) {
      this.ingest({
        client: fragment.client,
        sessionId: fragment.sessionId,
        turnId: parentTurnId,
        accountingMode: 'delta',
        metrics: emptyMetrics(),
        updatedAt: fragment.updatedAt,
        status: 'running',
      });
    }

    const parentState = session.turns.get(parentTurnId)!;
    const totalTokens =
      fragment.metrics.totalTokens ??
      fragment.metrics.inputTokens + fragment.metrics.outputTokens;

    const call: SubAgentCall = {
      id: meta.id,
      agentName: meta.agentName,
      role: meta.role,
      promptSummary: meta.promptSummary,
      inputTokens: fragment.metrics.inputTokens,
      cachedTokens: fragment.metrics.cachedTokens,
      reasoningTokens: fragment.metrics.reasoningTokens,
      outputTokens: fragment.metrics.outputTokens,
      totalTokens,
      durationMs: fragment.durationMs,
      status: fragment.status ?? 'completed',
    };

    parentState.subAgentMap.set(meta.id, call);
    parentState.turn.subAgentCalls = Array.from(parentState.subAgentMap.values());
    if (fragment.updatedAt > parentState.turn.updatedAt) {
      parentState.turn.updatedAt = fragment.updatedAt;
    }

    return {
      ...parentState.turn,
      subAgentCalls: [...parentState.turn.subAgentCalls],
    };
  }

  getTurns(client: ClientType, sessionId?: string): UnifiedTurnUsage[] {
    const results: UnifiedTurnUsage[] = [];
    for (const [key, session] of this.sessions.entries()) {
      if (!key.startsWith(`${client}::`)) continue;
      if (sessionId && key !== this.sessionKey(client, sessionId)) continue;
      for (const turnId of session.turnOrder) {
        const state = session.turns.get(turnId);
        if (state) results.push(state.turn);
      }
    }
    return results;
  }

  clear(): void {
    this.sessions.clear();
  }
}
