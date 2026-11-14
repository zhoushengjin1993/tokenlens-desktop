import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  BaseLogAdapter,
  checkClientHealth,
  getDefaultClientPaths,
  type AdapterHealth,
  type ClientType,
  type ToolCallSummary,
  type UnifiedTurnUsage,
} from '@tokenlens/core';
import { ByteOffsetTailer } from './utils/jsonl-tail.js';
import { findFiles, truncatePrompt } from './utils/fs-walk.js';
import { isSqliteBusyError, openReadOnlySqlite } from './utils/sqlite-ro.js';

interface AntigravitySessionCtx {
  sessionId: string;
  currentTurnId: string;
  turnStartedAt: number;
  promptSummary: string;
  inputChars: number;
  reasoningChars: number;
  outputChars: number;
}

interface AntigravityStep {
  step_index: number;
  source?: string;
  type?: string;
  status?: string;
  created_at?: string;
  content?: string;
  thinking?: string;
  tool_calls?: Array<{
    id?: string;
    name?: string;
    arguments?: string;
  }>;
  usage?: {
    input_tokens?: number;
    cached_tokens?: number;
    reasoning_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface SummaryRow {
  conversation_id: string;
  title: string;
  parent_conversation_id: string;
}

function estimateTokens(charCount: number): number {
  return charCount > 0 ? Math.max(1, Math.ceil(charCount / 4)) : 0;
}

export class AntigravityAdapter extends BaseLogAdapter {
  readonly client: ClientType = 'antigravity';
  private readonly tailer = new ByteOffsetTailer();
  private readonly contexts = new Map<string, AntigravitySessionCtx>();
  private readonly sessionTitles = new Map<string, string>();
  private watcher: FSWatcher | null = null;

  getDefaultPaths(): string[] {
    return this.options.watchPaths ?? [getDefaultClientPaths().antigravity[0]];
  }

  async checkHealth(): Promise<AdapterHealth> {
    return checkClientHealth(this.client, this.options.watchPaths);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.loadSummaries();
    await this.scanOnce();

    this.watcher = chokidar.watch(this.getDefaultPaths(), {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
    });

    const handleFile = async (filePath: string) => {
      if (!filePath.endsWith('transcript.jsonl')) return;
      try {
        await this.loadSummaries();
        const turns = await this.processFile(filePath);
        for (const t of turns) this.emitTurn(t);
      } catch (err) {
        this.emitError(err);
      }
    };

    this.watcher.on('add', handleFile);
    this.watcher.on('change', handleFile);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  async scanOnce(): Promise<UnifiedTurnUsage[]> {
    await this.loadSummaries();
    const files = await findFiles(
      this.getDefaultPaths(),
      (p) => path.basename(p) === 'transcript.jsonl',
    );
    const results: UnifiedTurnUsage[] = [];
    for (const file of files) {
      results.push(...(await this.processFile(file)));
    }
    return results;
  }

  private async loadSummaries(): Promise<void> {
    const dbPath = getDefaultClientPaths().antigravity[1];
    try {
      await fs.access(dbPath, fs.constants.R_OK);
    } catch {
      return;
    }

    let db;
    try {
      db = openReadOnlySqlite(dbPath, 3000);
      const rows = db
        .prepare('SELECT conversation_id, title, parent_conversation_id FROM conversation_summaries')
        .all() as unknown as SummaryRow[];
      for (const r of rows) {
        if (r.title) this.sessionTitles.set(r.conversation_id, r.title);
      }
    } catch (err) {
      if (!isSqliteBusyError(err)) {
        // Non-fatal metadata enrichment error
      }
    } finally {
      db?.close();
    }
  }

  private extractSessionId(filePath: string): string {
    // Expected: .../brain/<conversation-id>/.system_generated/logs/transcript.jsonl
    const parts = path.normalize(filePath).split(path.sep);
    const logsIdx = parts.lastIndexOf('logs');
    if (logsIdx >= 2 && parts[logsIdx - 1] === '.system_generated') {
      return parts[logsIdx - 2];
    }
    return path.basename(path.dirname(filePath));
  }

  private async processFile(filePath: string): Promise<UnifiedTurnUsage[]> {
    const steps = await this.tailer.readNewLines<AntigravityStep>(filePath);
    if (steps.length === 0) return [];

    const sessionId = this.extractSessionId(filePath);
    let ctx = this.contexts.get(filePath);
    if (!ctx) {
      ctx = {
        sessionId,
        currentTurnId: 'step_0',
        turnStartedAt: Date.now(),
        promptSummary: '',
        inputChars: 0,
        reasoningChars: 0,
        outputChars: 0,
      };
      this.contexts.set(filePath, ctx);
    }

    const updatedMap = new Map<string, UnifiedTurnUsage>();
    const sessionTitle = this.sessionTitles.get(sessionId);

    for (const step of steps) {
      const ts = step.created_at ? Date.parse(step.created_at) : Date.now();

      if (step.type === 'USER_INPUT') {
        ctx.currentTurnId = `step_${step.step_index}`;
        ctx.turnStartedAt = ts;
        ctx.promptSummary = truncatePrompt(step.content ?? '');
        ctx.inputChars = (step.content ?? '').length;
        ctx.reasoningChars = 0;
        ctx.outputChars = 0;

        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId: ctx.sessionId,
          sessionTitle,
          sourceMode: 'desktop',
          turnId: ctx.currentTurnId,
          messageId: ctx.currentTurnId,
          accountingMode: 'snapshot',
          promptSummary: ctx.promptSummary,
          metrics: {
            inputTokens: step.usage?.input_tokens ?? estimateTokens(ctx.inputChars),
            cachedTokens: step.usage?.cached_tokens ?? 0,
            reasoningTokens: 0,
            outputTokens: 0,
          },
          startedAt: ts,
          updatedAt: ts,
          status: 'running',
          usageAccuracy: step.usage ? 'exact' : 'estimated',
        });
        updatedMap.set(turn.turnId, turn);
        continue;
      }

      if (step.type === 'PLANNER_RESPONSE') {
        ctx.reasoningChars += (step.thinking ?? '').length;
        ctx.outputChars += (step.content ?? '').length;

        const toolCalls: ToolCallSummary[] = (step.tool_calls ?? []).map((tc, idx) => ({
          callId: tc.id ?? `${ctx.currentTurnId}_tc_${step.step_index}_${idx}`,
          name: tc.name ?? 'tool',
          status: 'completed',
        }));

        const hasPendingTools = toolCalls.length > 0;
        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId: ctx.sessionId,
          sessionTitle,
          sourceMode: 'desktop',
          turnId: ctx.currentTurnId,
          messageId: ctx.currentTurnId,
          accountingMode: 'snapshot',
          promptSummary: ctx.promptSummary,
          metrics: step.usage
            ? {
                inputTokens: Number(step.usage.input_tokens ?? 0),
                cachedTokens: Number(step.usage.cached_tokens ?? 0),
                reasoningTokens: Number(step.usage.reasoning_tokens ?? 0),
                outputTokens: Number(step.usage.output_tokens ?? 0),
                totalTokens: step.usage.total_tokens,
              }
            : {
                inputTokens: estimateTokens(ctx.inputChars),
                cachedTokens: 0,
                reasoningTokens: estimateTokens(ctx.reasoningChars),
                outputTokens: estimateTokens(ctx.outputChars),
              },
          startedAt: ctx.turnStartedAt,
          updatedAt: ts,
          status: hasPendingTools ? 'running' : 'completed',
          usageAccuracy: step.usage ? 'exact' : 'estimated',
          toolCalls,
        });
        updatedMap.set(turn.turnId, turn);
      }
    }

    return Array.from(updatedMap.values());
  }
}
