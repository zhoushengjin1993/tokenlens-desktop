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

const BASE_SYSTEM_TOKENS = 3500;

interface AntigravitySessionCtx {
  sessionId: string;
  currentTurnId: string;
  turnStartedAt: number;
  promptSummary: string;
  /** Cumulative context tokens carried into the current turn (system + prior turns) */
  historyTokens: number;
  /** Fresh input tokens in current turn (user prompt + tool outputs) */
  turnInputTokens: number;
  turnCachedTokens: number;
  turnReasoningTokens: number;
  turnOutputTokens: number;
  seenStepIndices: Set<number>;
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
  workspace_uris: string;
}

function estimateTokens(charCount: number): number {
  return charCount > 0 ? Math.max(1, Math.ceil(charCount / 4)) : 0;
}

function parseWorkspaceUri(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(',')[0]?.trim();
  if (!first) return undefined;
  if (first.startsWith('file:///')) {
    const decoded = decodeURIComponent(first.slice('file:///'.length));
    return process.platform === 'win32' ? decoded.replace(/\//g, '\\') : `/${decoded}`;
  }
  return first;
}

export class AntigravityAdapter extends BaseLogAdapter {
  readonly client: ClientType = 'antigravity';
  private readonly tailer = new ByteOffsetTailer();
  private readonly contexts = new Map<string, AntigravitySessionCtx>();
  private readonly sessionMeta = new Map<string, { title?: string; projectPath?: string }>();
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
      const base = path.basename(filePath);
      if (base !== 'transcript.jsonl' && base !== 'transcript_full.jsonl') return;
      try {
        await this.loadSummaries();
        const target = await this.resolvePreferredTranscript(path.dirname(filePath));
        if (target !== filePath && base === 'transcript.jsonl') return;
        const turns = await this.processFile(target);
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
    const candidates = await findFiles(
      this.getDefaultPaths(),
      (p) => path.basename(p) === 'transcript.jsonl' || path.basename(p) === 'transcript_full.jsonl',
    );

    // Deduplicate per logs directory, preferring transcript_full.jsonl over transcript.jsonl
    const byDir = new Map<string, string>();
    for (const file of candidates) {
      const dir = path.dirname(file);
      const existing = byDir.get(dir);
      if (!existing || path.basename(file) === 'transcript_full.jsonl') {
        byDir.set(dir, file);
      }
    }

    const results: UnifiedTurnUsage[] = [];
    for (const file of byDir.values()) {
      results.push(...(await this.processFile(file)));
    }
    return results;
  }

  private async resolvePreferredTranscript(logsDir: string): Promise<string> {
    const fullPath = path.join(logsDir, 'transcript_full.jsonl');
    try {
      await fs.access(fullPath, fs.constants.R_OK);
      return fullPath;
    } catch {
      return path.join(logsDir, 'transcript.jsonl');
    }
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
        .prepare('SELECT conversation_id, title, workspace_uris FROM conversation_summaries')
        .all() as unknown as SummaryRow[];
      for (const r of rows) {
        this.sessionMeta.set(r.conversation_id, {
          title: r.title || undefined,
          projectPath: parseWorkspaceUri(r.workspace_uris),
        });
      }
    } catch (err) {
      if (!isSqliteBusyError(err)) {
        // Non-fatal metadata enrichment error
      }
    } finally {
      db?.close();
    }
  }

  private async estimateStepToolOutputTokens(filePath: string, stepIndex: number): Promise<number> {
    // Expected: .../.system_generated/logs/transcript[_full].jsonl -> .../.system_generated/steps/<step_index>/
    const logsDir = path.dirname(filePath);
    const sysGenDir = path.dirname(logsDir);
    const stepDir = path.join(sysGenDir, 'steps', String(stepIndex));
    try {
      const entries = await fs.readdir(stepDir);
      let totalBytes = 0;
      for (const name of entries) {
        const st = await fs.stat(path.join(stepDir, name));
        if (st.isFile()) totalBytes += st.size;
      }
      return estimateTokens(totalBytes);
    } catch {
      return 0;
    }
  }

  private extractSessionId(filePath: string): string {
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
    let ctx = this.contexts.get(sessionId);
    if (!ctx) {
      ctx = {
        sessionId,
        currentTurnId: 'step_0',
        turnStartedAt: Date.now(),
        promptSummary: '',
        historyTokens: BASE_SYSTEM_TOKENS,
        turnInputTokens: 0,
        turnCachedTokens: 0,
        turnReasoningTokens: 0,
        turnOutputTokens: 0,
        seenStepIndices: new Set(),
      };
      this.contexts.set(sessionId, ctx);
    }

    const updatedMap = new Map<string, UnifiedTurnUsage>();
    const meta = this.sessionMeta.get(sessionId);

    for (const step of steps) {
      if (ctx.seenStepIndices.has(step.step_index)) continue;
      ctx.seenStepIndices.add(step.step_index);

      const ts = step.created_at ? Date.parse(step.created_at) : Date.now();

      if (step.type === 'USER_INPUT') {
        // Carry forward previous turn's fresh tokens into session history cache
        ctx.historyTokens += ctx.turnInputTokens + ctx.turnOutputTokens;

        ctx.currentTurnId = `step_${step.step_index}`;
        ctx.turnStartedAt = ts;
        ctx.promptSummary = truncatePrompt(step.content ?? '');
        const userTokens = estimateTokens((step.content ?? '').length);

        ctx.turnCachedTokens = ctx.historyTokens;
        ctx.turnInputTokens = userTokens;
        ctx.turnReasoningTokens = 0;
        ctx.turnOutputTokens = 0;

        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId: ctx.sessionId,
          sessionTitle: meta?.title,
          projectPath: meta?.projectPath,
          archived: false,
          sourceMode: 'desktop',
          turnId: ctx.currentTurnId,
          messageId: ctx.currentTurnId,
          accountingMode: 'snapshot',
          promptSummary: ctx.promptSummary,
          metrics: {
            inputTokens: step.usage?.input_tokens ?? ctx.turnInputTokens,
            cachedTokens: step.usage?.cached_tokens ?? ctx.turnCachedTokens,
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
        const toolArgsChars = (step.tool_calls ?? []).reduce(
          (acc, tc) => acc + (tc.name?.length ?? 0) + (tc.arguments?.length ?? 0),
          0,
        );
        const toolOutputTokens = await this.estimateStepToolOutputTokens(filePath, step.step_index);

        ctx.turnReasoningTokens += estimateTokens((step.thinking ?? '').length);
        ctx.turnOutputTokens += estimateTokens((step.content ?? '').length + toolArgsChars);
        ctx.turnInputTokens += toolOutputTokens;

        const toolCalls: ToolCallSummary[] = (step.tool_calls ?? []).map((tc, idx) => ({
          callId: tc.id ?? `${ctx.currentTurnId}_tc_${step.step_index}_${idx}`,
          name: tc.name ?? 'tool',
          status: 'completed',
        }));

        const hasPendingTools = toolCalls.length > 0;
        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId: ctx.sessionId,
          sessionTitle: meta?.title,
          projectPath: meta?.projectPath,
          archived: false,
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
                inputTokens: ctx.turnInputTokens,
                cachedTokens: ctx.turnCachedTokens,
                reasoningTokens: ctx.turnReasoningTokens,
                outputTokens: ctx.turnOutputTokens,
                totalTokens: ctx.turnInputTokens + ctx.turnOutputTokens,
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
