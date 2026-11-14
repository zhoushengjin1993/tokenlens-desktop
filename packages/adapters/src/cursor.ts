import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  BaseLogAdapter,
  checkClientHealth,
  getDefaultClientPaths,
  type AdapterHealth,
  type AdapterOptions,
  type ClientType,
  type UnifiedTurnUsage,
} from '@tokenlens/core';
import { isSqliteBusyError, openReadOnlySqlite } from './utils/sqlite-ro.js';

const BASE_SYSTEM_TOKENS = 2500;

interface CursorComposerMeta {
  composerId?: string;
  name?: string;
  createdAt?: number;
  lastUpdatedAt?: number;
  isArchived?: boolean;
  archived?: boolean;
}

interface CursorBubble {
  type?: number | string;
  bubbleId?: string;
  text?: string;
  rawText?: string;
  thinking?: { text?: string };
  modelType?: string;
  selectedModel?: string;
  modelInfo?: { modelName?: string };
  tokenCount?: { inputTokens?: number; outputTokens?: number };
  approximateTokenCount?: number;
  timestamp?: number;
  createdAt?: number | string;
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 3.5);
}

function parseTimestamp(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return Date.now();
}

function decodeFileUri(uri: string): string {
  try {
    if (uri.startsWith('file:///')) {
      const p = decodeURIComponent(uri.replace(/^file:\/\/\//, ''));
      return /^[a-zA-Z]:/.test(p) ? p.replace(/\//g, path.sep) : `/${p}`;
    }
  } catch {
    // Fallback to raw
  }
  return uri;
}

async function readWorkspaceProjectPath(wsDir: string): Promise<string | undefined> {
  try {
    const raw = await fs.readFile(path.join(wsDir, 'workspace.json'), 'utf8');
    const parsed = JSON.parse(raw) as { folder?: string };
    if (parsed.folder) return decodeFileUri(parsed.folder);
  } catch {
    // Ignore missing workspace.json
  }
  return undefined;
}

function extractItemTableJson<T>(db: DatabaseSync, key: string): T | null {
  try {
    const row = db
      .prepare('SELECT value FROM ItemTable WHERE key = ?')
      .get(key) as { value?: string | Uint8Array } | undefined;
    if (!row?.value) return null;
    const text =
      typeof row.value === 'string' ? row.value : Buffer.from(row.value).toString('utf8');
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export class CursorAdapter extends BaseLogAdapter {
  readonly client: ClientType = 'cursor';
  private timer: NodeJS.Timeout | null = null;
  private lastSeenKey = new Map<string, string>();

  constructor(options: AdapterOptions = {}) {
    super(options);
  }

  getDefaultPaths(): string[] {
    return this.options.watchPaths ?? getDefaultClientPaths().cursor;
  }

  async checkHealth(): Promise<AdapterHealth> {
    return checkClientHealth(this.client, this.options.watchPaths);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.scanOnce();

    const interval = this.options.pollIntervalMs ?? 2000;
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
    const watchPaths = this.getDefaultPaths();
    const dbTargets: Array<{ dbPath: string; projectPath?: string }> = [];

    for (const root of watchPaths) {
      try {
        const stat = await fs.stat(root);
        if (stat.isFile() && root.endsWith('.vscdb')) {
          dbTargets.push({ dbPath: root });
        } else if (stat.isDirectory()) {
          const entries = await fs.readdir(root, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const wsDir = path.join(root, entry.name);
            const dbPath = path.join(wsDir, 'state.vscdb');
            try {
              await fs.access(dbPath);
              const projectPath = await readWorkspaceProjectPath(wsDir);
              dbTargets.push({ dbPath, projectPath });
            } catch {
              // Not a workspace state.vscdb
            }
          }
        }
      } catch {
        // Ignore missing path
      }
    }

    const updated: UnifiedTurnUsage[] = [];
    for (const target of dbTargets) {
      updated.push(...this.readStateDb(target.dbPath, target.projectPath));
    }
    return updated;
  }

  private readStateDb(dbPath: string, projectPath?: string): UnifiedTurnUsage[] {
    const updated: UnifiedTurnUsage[] = [];
    let db: DatabaseSync | null = null;
    try {
      db = openReadOnlySqlite(dbPath);

      const composerMetaMap = new Map<string, CursorComposerMeta>();
      const composerData = extractItemTableJson<{ allComposers?: CursorComposerMeta[] }>(
        db,
        'composer.composerData',
      );
      for (const c of composerData?.allComposers ?? []) {
        if (c.composerId) composerMetaMap.set(c.composerId, c);
      }

      // 1. Classic AI Chat tabs in workspace state.vscdb
      const chatData = extractItemTableJson<{
        tabs?: Array<{
          tabId?: string;
          chatTitle?: string;
          tabTitle?: string;
          bubbles?: CursorBubble[];
        }>;
      }>(db, 'workbench.panel.aichat.view.aichat.chatdata');

      for (const tab of chatData?.tabs ?? []) {
        const sessionId = tab.tabId || `${path.basename(path.dirname(dbPath))}-chat`;
        const sessionTitle = tab.chatTitle || tab.tabTitle;
        updated.push(
          ...this.ingestBubbles(
            sessionId,
            sessionTitle,
            projectPath,
            false,
            undefined,
            tab.bubbles ?? [],
          ),
        );
      }

      // 2. Newer Cursor Composer conversations in cursorDiskKV (globalStorage/state.vscdb)
      const hasDiskKv = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cursorDiskKV'")
        .get() as { name?: string } | undefined;

      if (hasDiskKv?.name) {
        const compRows = db
          .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%' LIMIT 100")
          .all() as Array<{ key: string; value: string | Uint8Array }>;

        for (const row of compRows) {
          try {
            const text =
              typeof row.value === 'string'
                ? row.value
                : Buffer.from(row.value).toString('utf8');
            const parsed = JSON.parse(text) as CursorComposerMeta & {
              conversation?: CursorBubble[];
              fullConversationHeadersOnly?: Array<{ bubbleId?: string; type?: number }>;
            };
            const composerId = parsed.composerId || row.key.replace('composerData:', '');
            const meta = composerMetaMap.get(composerId);
            const archived = Boolean(
              parsed.isArchived ?? parsed.archived ?? meta?.isArchived ?? meta?.archived,
            );
            const title = parsed.name || meta?.name;

            let bubbles = parsed.conversation ?? [];
            if (bubbles.length === 0 && parsed.fullConversationHeadersOnly?.length) {
              const loaded: CursorBubble[] = [];
              const stmt = db.prepare('SELECT value FROM cursorDiskKV WHERE key = ?');
              for (const hdr of parsed.fullConversationHeadersOnly) {
                if (!hdr.bubbleId) continue;
                const bRow = stmt.get(`bubbleId:${composerId}:${hdr.bubbleId}`) as
                  | { value?: string | Uint8Array }
                  | undefined;
                if (!bRow?.value) continue;
                const bText =
                  typeof bRow.value === 'string'
                    ? bRow.value
                    : Buffer.from(bRow.value).toString('utf8');
                loaded.push(JSON.parse(bText) as CursorBubble);
              }
              bubbles = loaded;
            }

            if (bubbles.length > 0) {
              updated.push(
                ...this.ingestBubbles(
                  composerId,
                  title,
                  projectPath,
                  archived,
                  archived ? parsed.lastUpdatedAt ?? meta?.lastUpdatedAt : undefined,
                  bubbles,
                ),
              );
            }
          } catch {
            // Skip malformed composerData row
          }
        }
      }
    } catch {
      // Ignore locked or unreadable sqlite
    } finally {
      try {
        db?.close();
      } catch {
        // Ignore
      }
    }
    return updated;
  }

  private ingestBubbles(
    sessionId: string,
    sessionTitle: string | undefined,
    projectPath: string | undefined,
    archived: boolean,
    archivedAt: number | undefined,
    bubbles: CursorBubble[],
  ): UnifiedTurnUsage[] {
    const updated: UnifiedTurnUsage[] = [];
    let turnIndex = 0;
    let historyTokens = BASE_SYSTEM_TOKENS;
    let pendingUser: CursorBubble | null = null;

    for (const b of bubbles) {
      const isUser = b.type === 'user' || b.type === 1;
      if (isUser) {
        pendingUser = b;
        continue;
      }

      const isAi = b.type === 'ai' || b.type === 2;
      if (!isAi) continue;

      turnIndex += 1;
      const turnId = b.bubbleId || `cursor-${sessionId}-${turnIndex}`;
      const userText = pendingUser?.text || pendingUser?.rawText || '';
      const aiText = b.text || b.rawText || '';
      const thinkText = b.thinking?.text || '';

      const exactInput = b.tokenCount?.inputTokens ?? 0;
      const exactOutput = b.tokenCount?.outputTokens ?? 0;
      const hasExact = exactInput > 0 || exactOutput > 0;

      const userTokens = estimateTokens(userText);
      const outputTokens = hasExact
        ? exactOutput
        : Math.max(b.approximateTokenCount ?? 0, estimateTokens(aiText));
      const reasoningTokens = estimateTokens(thinkText);
      const inputTokens = hasExact ? exactInput : userTokens;
      const cachedTokens = hasExact ? 0 : historyTokens;

      const startedAt = parseTimestamp(pendingUser?.timestamp ?? pendingUser?.createdAt);
      const updatedAt = Math.max(
        startedAt,
        parseTimestamp(b.timestamp ?? b.createdAt ?? startedAt),
      );
      const model = b.modelInfo?.modelName || b.selectedModel || b.modelType;

      const compositeKey = `${sessionId}::${turnId}`;
      const sig = `${inputTokens}:${cachedTokens}:${outputTokens}:${reasoningTokens}:${archived}`;
      const prevSig = this.lastSeenKey.get(compositeKey);
      this.lastSeenKey.set(compositeKey, sig);

      const turn = this.aggregator.ingest({
        client: 'cursor',
        projectPath,
        archived,
        archivedAt,
        sourceMode: 'desktop',
        sessionId,
        sessionTitle,
        turnId,
        messageId: turnId,
        accountingMode: 'snapshot',
        model,
        promptSummary: userText.replace(/\s+/g, ' ').trim().slice(0, 140) || undefined,
        metrics: {
          inputTokens,
          cachedTokens,
          reasoningTokens,
          outputTokens,
        },
        durationMs: Math.max(0, updatedAt - startedAt),
        startedAt,
        updatedAt,
        status: 'completed',
        usageAccuracy: hasExact ? 'exact' : 'estimated',
      });

      if (prevSig !== sig) {
        updated.push(turn);
      }

      historyTokens += userTokens + outputTokens + reasoningTokens;
      pendingUser = null;
    }

    return updated;
  }
}
