import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  BaseLogAdapter,
  checkClientHealth,
  getDefaultClientPaths,
  type AdapterHealth,
  type ClientType,
  type UnifiedTurnUsage,
} from '@tokenlens/core';
import { ByteOffsetTailer } from './utils/jsonl-tail.js';
import { findFiles, truncatePrompt } from './utils/fs-walk.js';

interface ClaudeSessionCtx {
  currentTurnId: string;
  turnCounter: number;
  projectPath?: string;
  lastPrompt?: string;
}

interface ClaudeJsonlEntry {
  type?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  promptId?: string;
  timestamp?: string;
  entrypoint?: string;
  cwd?: string;
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: string | Array<{ type?: string; text?: string; thinking?: string; name?: string; id?: string }>;
    stop_reason?: string | null;
    usage?: {
      input_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      output_tokens?: number;
    };
  };
}

export class ClaudeAdapter extends BaseLogAdapter {
  readonly client: ClientType = 'claude';
  private readonly tailer = new ByteOffsetTailer();
  private readonly contexts = new Map<string, ClaudeSessionCtx>();
  private watcher: FSWatcher | null = null;

  getDefaultPaths(): string[] {
    return this.options.watchPaths ?? [getDefaultClientPaths().claude[0]];
  }

  async checkHealth(): Promise<AdapterHealth> {
    return checkClientHealth(this.client, this.options.watchPaths);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.scanOnce();

    this.watcher = chokidar.watch(this.getDefaultPaths(), {
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
    });

    const handleFile = async (filePath: string) => {
      if (!filePath.endsWith('.jsonl')) return;
      try {
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
    const files = await findFiles(this.getDefaultPaths(), (p) => p.endsWith('.jsonl'));
    const results: UnifiedTurnUsage[] = [];
    for (const file of files) {
      results.push(...(await this.processFile(file)));
    }
    return results;
  }

  private async processFile(filePath: string): Promise<UnifiedTurnUsage[]> {
    const entries = await this.tailer.readNewLines<ClaudeJsonlEntry>(filePath);
    if (entries.length === 0) return [];

    let ctx = this.contexts.get(filePath);
    if (!ctx) {
      ctx = { currentTurnId: 'turn_1', turnCounter: 0 };
      this.contexts.set(filePath, ctx);
    }

    const updatedMap = new Map<string, UnifiedTurnUsage>();

    for (const entry of entries) {
      const ts = entry.timestamp ? Date.parse(entry.timestamp) : Date.now();
      const sessionId = entry.sessionId ?? path.basename(filePath, '.jsonl');
      const sourceMode = entry.entrypoint?.includes('cli') ? 'cli' : 'desktop';
      if (entry.cwd && !ctx.projectPath) ctx.projectPath = entry.cwd;

      if (entry.type === 'user' && entry.message) {
        ctx.turnCounter += 1;
        ctx.currentTurnId = entry.promptId ?? entry.uuid ?? `turn_${ctx.turnCounter}`;
        const rawContent = entry.message.content;
        let text = '';
        if (typeof rawContent === 'string') text = rawContent;
        else if (Array.isArray(rawContent)) {
          text = rawContent.map((c) => c.text ?? '').join(' ');
        }
        ctx.lastPrompt = truncatePrompt(text);

        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId,
          projectPath: ctx.projectPath,
          sourceMode,
          turnId: ctx.currentTurnId,
          accountingMode: 'snapshot',
          promptSummary: ctx.lastPrompt,
          metrics: { inputTokens: 0, cachedTokens: 0, reasoningTokens: 0, outputTokens: 0 },
          startedAt: ts,
          updatedAt: ts,
          status: 'running',
          usageAccuracy: 'exact',
        });
        updatedMap.set(turn.turnId, turn);
        continue;
      }

      if (entry.type === 'assistant' && entry.message) {
        const msg = entry.message;
        const usage = msg.usage;
        const messageId = msg.id ?? entry.uuid ?? `msg_${ts}`;
        const isDone = msg.stop_reason !== null && msg.stop_reason !== undefined;

        const toolCalls = Array.isArray(msg.content)
          ? msg.content
              .filter((c) => c.type === 'tool_use' && c.name)
              .map((c) => ({
                callId: c.id ?? `${messageId}_${c.name}`,
                name: c.name!,
                status: 'completed' as const,
              }))
          : undefined;

        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId,
          sourceMode,
          turnId: ctx.currentTurnId,
          messageId,
          accountingMode: 'snapshot',
          model: msg.model,
          promptSummary: ctx.lastPrompt,
          metrics: {
            inputTokens: Number(usage?.input_tokens ?? 0),
            cachedTokens: Number(usage?.cache_read_input_tokens ?? 0),
            cacheCreationTokens: Number(usage?.cache_creation_input_tokens ?? 0),
            reasoningTokens: 0,
            outputTokens: Number(usage?.output_tokens ?? 0),
          },
          updatedAt: ts,
          status: isDone ? 'completed' : 'running',
          usageAccuracy: 'exact',
          toolCalls,
          ...(entry.isSidechain
            ? {
                parentTurnId: ctx.currentTurnId,
                subAgentMeta: {
                  id: entry.uuid ?? messageId,
                  agentName: 'claude-subagent',
                  promptSummary: ctx.lastPrompt,
                },
              }
            : {}),
        });
        updatedMap.set(turn.turnId, turn);
      }
    }

    return Array.from(updatedMap.values());
  }
}
