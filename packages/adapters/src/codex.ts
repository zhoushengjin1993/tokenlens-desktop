import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  BaseLogAdapter,
  checkClientHealth,
  getDefaultClientPaths,
  type AdapterHealth,
  type ClientType,
  type SourceMode,
  type UnifiedTurnUsage,
} from '@tokenlens/core';
import { ByteOffsetTailer } from './utils/jsonl-tail.js';
import { findFiles, truncatePrompt } from './utils/fs-walk.js';

interface CodexSessionContext {
  sessionId: string;
  sourceMode: SourceMode;
  currentTurnId: string;
  model?: string;
  turnStartedAt?: number;
  lastPrompt?: string;
}

interface CodexEvent {
  timestamp?: string;
  type: string;
  payload?: Record<string, unknown>;
}

export class CodexAdapter extends BaseLogAdapter {
  readonly client: ClientType = 'codex';
  private readonly tailer = new ByteOffsetTailer();
  private readonly contexts = new Map<string, CodexSessionContext>();
  private watcher: FSWatcher | null = null;

  getDefaultPaths(): string[] {
    return this.options.watchPaths ?? [getDefaultClientPaths().codex[0]];
  }

  async checkHealth(): Promise<AdapterHealth> {
    return checkClientHealth(this.client, this.options.watchPaths);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.scanOnce();

    const watchRoots = this.getDefaultPaths();
    this.watcher = chokidar.watch(watchRoots, {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
    });

    const handleFile = async (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return;
      try {
        const updated = await this.processFile(filePath);
        for (const turn of updated) this.emitTurn(turn);
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
    const files = await findFiles(this.getDefaultPaths(), (p) => p.endsWith('.jsonl'));
    const results: UnifiedTurnUsage[] = [];
    for (const file of files) {
      const turns = await this.processFile(file);
      results.push(...turns);
    }
    return results;
  }

  private async processFile(filePath: string): Promise<UnifiedTurnUsage[]> {
    const events = await this.tailer.readNewLines<CodexEvent>(filePath);
    if (events.length === 0) return [];

    let ctx = this.contexts.get(filePath);
    if (!ctx) {
      ctx = {
        sessionId: path.basename(filePath, '.jsonl'),
        sourceMode: 'unknown',
        currentTurnId: 'turn_1',
      };
      this.contexts.set(filePath, ctx);
    }

    const updatedMap = new Map<string, UnifiedTurnUsage>();

    for (const ev of events) {
      const ts = ev.timestamp ? Date.parse(ev.timestamp) : Date.now();
      const payload = ev.payload ?? {};

      if (ev.type === 'session_meta') {
        if (typeof payload.id === 'string') ctx.sessionId = payload.id;
        else if (typeof payload.session_id === 'string') ctx.sessionId = payload.session_id;
        const orig = String(payload.originator ?? payload.source ?? '').toLowerCase();
        if (orig.includes('cli')) ctx.sourceMode = 'cli';
        else if (orig.includes('desktop') || orig.includes('vscode') || orig.includes('app')) {
          ctx.sourceMode = 'desktop';
        }
        continue;
      }

      if (ev.type === 'turn_context') {
        if (typeof payload.turn_id === 'string') ctx.currentTurnId = payload.turn_id;
        if (typeof payload.model === 'string') ctx.model = payload.model;
        continue;
      }

      if (ev.type === 'event_msg') {
        const subType = payload.type;
        if (subType === 'task_started') {
          if (typeof payload.turn_id === 'string') ctx.currentTurnId = payload.turn_id;
          ctx.turnStartedAt = typeof payload.started_at === 'number' ? payload.started_at : ts;
          ctx.lastPrompt = undefined;
          const turn = this.aggregator.ingest({
            client: this.client,
            sessionId: ctx.sessionId,
            sourceMode: ctx.sourceMode,
            turnId: ctx.currentTurnId,
            accountingMode: 'delta',
            model: ctx.model,
            metrics: { inputTokens: 0, cachedTokens: 0, reasoningTokens: 0, outputTokens: 0 },
            startedAt: ctx.turnStartedAt,
            updatedAt: ts,
            status: 'running',
            usageAccuracy: 'exact',
          });
          updatedMap.set(turn.turnId, turn);
        } else if (subType === 'token_count') {
          const info = (payload.info ?? {}) as Record<string, unknown>;
          const last = info.last_token_usage as Record<string, number> | undefined;
          const total = info.total_token_usage as Record<string, number> | undefined;
          const usage = last ?? total;
          if (!usage) continue;

          const turn = this.aggregator.ingest({
            client: this.client,
            sessionId: ctx.sessionId,
            sourceMode: ctx.sourceMode,
            turnId: ctx.currentTurnId,
            messageId: last ? `tok_${ev.timestamp ?? ts}` : undefined,
            accountingMode: last ? 'delta' : 'cumulative',
            model: ctx.model,
            promptSummary: ctx.lastPrompt,
            metrics: {
              inputTokens: Number(usage.input_tokens ?? 0),
              cachedTokens: Number(usage.cached_input_tokens ?? 0),
              cacheCreationTokens: Number(usage.cache_write_input_tokens ?? 0),
              reasoningTokens: Number(usage.reasoning_output_tokens ?? 0),
              outputTokens: Number(usage.output_tokens ?? 0),
              totalTokens: usage.total_tokens !== undefined ? Number(usage.total_tokens) : undefined,
            },
            startedAt: ctx.turnStartedAt,
            updatedAt: ts,
            status: 'running',
            usageAccuracy: 'exact',
          });
          updatedMap.set(turn.turnId, turn);
        } else if (subType === 'task_complete' || subType === 'turn_aborted') {
          const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : ctx.currentTurnId;
          const turn = this.aggregator.ingest({
            client: this.client,
            sessionId: ctx.sessionId,
            sourceMode: ctx.sourceMode,
            turnId,
            accountingMode: 'delta',
            metrics: { inputTokens: 0, cachedTokens: 0, reasoningTokens: 0, outputTokens: 0 },
            updatedAt: ts,
            status: subType === 'task_complete' ? 'completed' : 'incomplete',
          });
          updatedMap.set(turn.turnId, turn);
        }
        continue;
      }

      if (ev.type === 'token_usage_record') {
        const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : ctx.currentTurnId;
        const usage = (payload.turn_token_usage ?? payload.usage ?? {}) as Record<string, number>;
        const responseId = typeof payload.response_id === 'string' ? payload.response_id : undefined;
        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId: ctx.sessionId,
          sourceMode: ctx.sourceMode,
          turnId,
          messageId: responseId,
          accountingMode: responseId ? 'snapshot' : 'delta',
          model: ctx.model,
          promptSummary: ctx.lastPrompt,
          metrics: {
            inputTokens: Number(usage.input_tokens ?? 0),
            cachedTokens: Number(usage.cached_input_tokens ?? 0),
            cacheCreationTokens: Number(usage.cache_write_input_tokens ?? 0),
            reasoningTokens: Number(usage.reasoning_output_tokens ?? 0),
            outputTokens: Number(usage.output_tokens ?? 0),
            totalTokens: usage.total_tokens !== undefined ? Number(usage.total_tokens) : undefined,
          },
          startedAt: ctx.turnStartedAt,
          updatedAt: ts,
          usageAccuracy: 'exact',
        });
        updatedMap.set(turn.turnId, turn);
        continue;
      }

      if (ev.type === 'response_item') {
        if (payload.type === 'message' && payload.role === 'user') {
          const content = payload.content;
          let text = '';
          if (typeof content === 'string') text = content;
          else if (Array.isArray(content)) {
            text = content
              .map((c: Record<string, unknown>) => (typeof c.text === 'string' ? c.text : ''))
              .join(' ');
          }
          if (text) {
            ctx.lastPrompt = truncatePrompt(text);
            const turn = this.aggregator.ingest({
              client: this.client,
              sessionId: ctx.sessionId,
              turnId: ctx.currentTurnId,
              accountingMode: 'delta',
              promptSummary: ctx.lastPrompt,
              metrics: { inputTokens: 0, cachedTokens: 0, reasoningTokens: 0, outputTokens: 0 },
              updatedAt: ts,
            });
            updatedMap.set(turn.turnId, turn);
          }
        } else if (payload.type === 'custom_tool_call') {
          const callId = String(payload.call_id ?? payload.id ?? `call_${ts}`);
          const name = String(payload.name ?? 'tool');
          const turn = this.aggregator.ingest({
            client: this.client,
            sessionId: ctx.sessionId,
            turnId: ctx.currentTurnId,
            accountingMode: 'delta',
            metrics: { inputTokens: 0, cachedTokens: 0, reasoningTokens: 0, outputTokens: 0 },
            updatedAt: ts,
            toolCalls: [
              {
                callId,
                name,
                status: payload.status === 'completed' ? 'completed' : 'running',
              },
            ],
          });
          updatedMap.set(turn.turnId, turn);
        }
      }
    }

    return Array.from(updatedMap.values());
  }
}
