import fs from 'node:fs/promises';
import {
  BaseLogAdapter,
  checkClientHealth,
  getDefaultClientPaths,
  type AdapterHealth,
  type ClientType,
  type TurnStatus,
  type UnifiedTurnUsage,
} from '@tokenlens/core';
import { isSqliteBusyError, openReadOnlySqlite } from './utils/sqlite-ro.js';
import { truncatePrompt } from './utils/fs-walk.js';

interface ZcodeTurnRow {
  session_id: string;
  session_title: string | null;
  turn_id: string;
  user_message_id: string | null;
  status: string;
  started_at: number;
  completed_at: number | null;
  duration_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  computed_total_tokens: number;
  model_id: string | null;
  prompt_text: string | null;
}

function mapZcodeStatus(status: string): TurnStatus {
  if (status === 'completed') return 'completed';
  if (status === 'running') return 'running';
  return 'incomplete';
}

export class ZcodeAdapter extends BaseLogAdapter {
  readonly client: ClientType = 'zcode';
  private timer: NodeJS.Timeout | null = null;
  private lastSeenKey = new Map<string, string>();

  getDefaultPaths(): string[] {
    return this.options.watchPaths ?? [getDefaultClientPaths().zcode[0]];
  }

  async checkHealth(): Promise<AdapterHealth> {
    return checkClientHealth(this.client, this.options.watchPaths);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.scanOnce();

    const interval = this.options.pollIntervalMs ?? 500;
    this.timer = setInterval(async () => {
      if (!this.running) return;
      try {
        const updated = await this.scanOnce();
        for (const turn of updated) this.emitTurn(turn);
      } catch (err) {
        if (!isSqliteBusyError(err)) this.emitError(err);
      }
    }, interval);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async scanOnce(): Promise<UnifiedTurnUsage[]> {
    const updated: UnifiedTurnUsage[] = [];

    for (const dbPath of this.getDefaultPaths()) {
      try {
        await fs.access(dbPath, fs.constants.R_OK);
      } catch {
        continue;
      }

      let db;
      try {
        db = openReadOnlySqlite(dbPath, 3000);
        const hasTurnUsage = db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='turn_usage'")
          .get();
        if (!hasTurnUsage) continue;

        const rows = db
          .prepare(
            `
            SELECT
              t.session_id,
              s.title AS session_title,
              t.turn_id,
              t.user_message_id,
              t.status,
              t.started_at,
              t.completed_at,
              t.duration_ms,
              t.input_tokens,
              t.output_tokens,
              t.reasoning_tokens,
              t.cache_creation_input_tokens,
              t.cache_read_input_tokens,
              t.computed_total_tokens,
              (
                SELECT m.model_id FROM model_usage m
                WHERE m.session_id = t.session_id AND m.turn_id = t.turn_id
                ORDER BY m.started_at DESC LIMIT 1
              ) AS model_id,
              (
                SELECT p.data FROM part p
                WHERE p.message_id = t.user_message_id
                ORDER BY p.time_created ASC LIMIT 1
              ) AS prompt_text
            FROM turn_usage t
            LEFT JOIN session s ON s.id = t.session_id
            ORDER BY t.started_at ASC
          `,
          )
          .all() as unknown as ZcodeTurnRow[];

        for (const row of rows) {
          const updatedAt = row.completed_at ?? row.started_at;
          const fingerprint = `${row.status}:${row.computed_total_tokens}:${row.output_tokens}:${updatedAt}`;
          const cacheKey = `${row.session_id}::${row.turn_id}`;
          if (this.lastSeenKey.get(cacheKey) === fingerprint) continue;
          this.lastSeenKey.set(cacheKey, fingerprint);

          let promptSummary = '';
          if (row.prompt_text) {
            try {
              const parsed = JSON.parse(row.prompt_text) as { text?: string };
              promptSummary = truncatePrompt(parsed.text ?? row.prompt_text);
            } catch {
              promptSummary = truncatePrompt(row.prompt_text);
            }
          }

          const turn = this.aggregator.ingest({
            client: this.client,
            sessionId: row.session_id,
            sessionTitle: row.session_title ?? undefined,
            sourceMode: 'cli',
            turnId: row.turn_id,
            messageId: row.turn_id,
            accountingMode: 'snapshot',
            model: row.model_id ?? undefined,
            promptSummary,
            metrics: {
              inputTokens: row.input_tokens ?? 0,
              cachedTokens: row.cache_read_input_tokens ?? 0,
              cacheCreationTokens: row.cache_creation_input_tokens ?? 0,
              reasoningTokens: row.reasoning_tokens ?? 0,
              outputTokens: row.output_tokens ?? 0,
              totalTokens: row.computed_total_tokens ?? undefined,
            },
            startedAt: row.started_at,
            updatedAt,
            durationMs: row.duration_ms ?? undefined,
            status: mapZcodeStatus(row.status),
            usageAccuracy: 'exact',
          });
          updated.push(turn);
        }
      } catch (err) {
        if (!isSqliteBusyError(err)) throw err;
      } finally {
        db?.close();
      }
    }

    return updated;
  }
}
