import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import chokidar, { type FSWatcher } from 'chokidar';
import {
  BaseLogAdapter,
  checkClientHealth,
  getDefaultClientPaths,
  type AdapterHealth,
  type ClientType,
  type UnifiedTurnUsage,
} from '@tokenlens/core';
import { findFiles, truncatePrompt } from './utils/fs-walk.js';

interface FileSignature {
  mtimeMs: number;
  size: number;
}

interface DshEvent {
  type?: string;
  event?: string;
  sessionId?: string;
  turnId?: string;
  timestamp?: number | string;
  model?: string;
  prompt?: string;
  durationMs?: number;
  compacted?: boolean;
  usage?: {
    input_tokens?: number;
    cached_tokens?: number;
    cache_read_input_tokens?: number;
    reasoning_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
  subAgent?: {
    id: string;
    name?: string;
    role?: string;
    prompt?: string;
  };
}

class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly maxEntries = 100) {}

  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

export class DshAdapter extends BaseLogAdapter {
  readonly client: ClientType = 'dsh';
  private watcher: FSWatcher | null = null;
  private readonly signatures = new Map<string, FileSignature>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly completedCache = new LruCache<string, UnifiedTurnUsage[]>(100);

  getDefaultPaths(): string[] {
    return this.options.watchPaths ?? [getDefaultClientPaths().dsh[0]];
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
    });

    const scheduleProcess = (filePath: string) => {
      if (!filePath.endsWith('.jsonl.zstd')) return;
      const existing = this.debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(async () => {
        this.debounceTimers.delete(filePath);
        try {
          const turns = await this.processFile(filePath);
          for (const t of turns) this.emitTurn(t);
        } catch (err) {
          this.emitError(err);
        }
      }, 500);

      this.debounceTimers.set(filePath, timer);
    };

    this.watcher.on('add', scheduleProcess);
    this.watcher.on('change', scheduleProcess);
  }

  async stop(): Promise<void> {
    this.running = false;
    for (const timer of this.debounceTimers.values()) clearTimeout(timer);
    this.debounceTimers.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  async scanOnce(): Promise<UnifiedTurnUsage[]> {
    const files = await findFiles(this.getDefaultPaths(), (p) => p.endsWith('.jsonl.zstd'));
    const results: UnifiedTurnUsage[] = [];
    for (const file of files) {
      results.push(...(await this.processFile(file)));
    }
    return results;
  }

  private async processFile(filePath: string): Promise<UnifiedTurnUsage[]> {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return [];
    }

    const prevSig = this.signatures.get(filePath);
    if (prevSig && prevSig.mtimeMs === stat.mtimeMs && prevSig.size === stat.size) {
      return this.completedCache.get(filePath) ?? [];
    }

    const compressed = await fs.readFile(filePath);
    const decompressed = zlib.zstdDecompressSync(compressed).toString('utf8');
    this.signatures.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size });

    const sessionId = path.basename(path.dirname(filePath)) || path.basename(filePath, '.jsonl.zstd');
    const updatedMap = new Map<string, UnifiedTurnUsage>();
    let currentTurnId = 'turn_1';
    let turnCounter = 0;

    for (const rawLine of decompressed.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      let ev: DshEvent;
      try {
        ev = JSON.parse(trimmed) as DshEvent;
      } catch {
        continue;
      }

      const kind = ev.type ?? ev.event ?? '';
      const ts =
        typeof ev.timestamp === 'number'
          ? ev.timestamp
          : ev.timestamp
            ? Date.parse(ev.timestamp)
            : stat.mtimeMs;
      const sid = ev.sessionId ?? sessionId;

      if (kind === 'turn/start') {
        turnCounter += 1;
        currentTurnId = ev.turnId ?? `turn_${turnCounter}`;
        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId: sid,
          sourceMode: 'cli',
          turnId: currentTurnId,
          messageId: currentTurnId,
          accountingMode: 'snapshot',
          model: ev.model,
          promptSummary: ev.prompt ? truncatePrompt(ev.prompt) : undefined,
          metrics: { inputTokens: 0, cachedTokens: 0, reasoningTokens: 0, outputTokens: 0 },
          startedAt: ts,
          updatedAt: ts,
          status: 'running',
          usageAccuracy: 'exact',
        });
        updatedMap.set(turn.turnId, turn);
      } else if (kind === 'turn/end' || kind === 'turn/usage') {
        const turnId = ev.turnId ?? currentTurnId;
        const u = ev.usage ?? {};
        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId: sid,
          sourceMode: 'cli',
          turnId,
          messageId: turnId,
          accountingMode: 'snapshot',
          model: ev.model,
          promptSummary: ev.prompt ? truncatePrompt(ev.prompt) : undefined,
          metrics: {
            inputTokens: Number(u.input_tokens ?? 0),
            cachedTokens: Number(u.cached_tokens ?? u.cache_read_input_tokens ?? 0),
            reasoningTokens: Number(u.reasoning_tokens ?? 0),
            outputTokens: Number(u.output_tokens ?? 0),
            totalTokens: u.total_tokens !== undefined ? Number(u.total_tokens) : undefined,
          },
          updatedAt: ts,
          durationMs: ev.durationMs,
          compacted: ev.compacted,
          status: kind === 'turn/end' ? 'completed' : 'running',
          usageAccuracy: 'exact',
        });
        updatedMap.set(turn.turnId, turn);
      } else if (kind === 'subagent/end' && ev.subAgent) {
        const u = ev.usage ?? {};
        const turn = this.aggregator.ingest({
          client: this.client,
          sessionId: sid,
          turnId: ev.turnId ?? currentTurnId,
          parentTurnId: ev.turnId ?? currentTurnId,
          accountingMode: 'snapshot',
          metrics: {
            inputTokens: Number(u.input_tokens ?? 0),
            cachedTokens: Number(u.cached_tokens ?? u.cache_read_input_tokens ?? 0),
            reasoningTokens: Number(u.reasoning_tokens ?? 0),
            outputTokens: Number(u.output_tokens ?? 0),
            totalTokens: u.total_tokens !== undefined ? Number(u.total_tokens) : undefined,
          },
          updatedAt: ts,
          durationMs: ev.durationMs,
          status: 'completed',
          subAgentMeta: {
            id: ev.subAgent.id,
            agentName: ev.subAgent.name,
            role: ev.subAgent.role,
            promptSummary: ev.subAgent.prompt ? truncatePrompt(ev.subAgent.prompt) : undefined,
          },
        });
        updatedMap.set(turn.turnId, turn);
      }
    }

    const turns = Array.from(updatedMap.values());
    if (turns.length > 0 && turns.every((t) => t.status === 'completed')) {
      this.completedCache.set(filePath, turns);
    }
    return turns;
  }
}
