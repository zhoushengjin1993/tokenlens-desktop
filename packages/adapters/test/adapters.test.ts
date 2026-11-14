import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AntigravityAdapter,
  ClaudeAdapter,
  CodexAdapter,
  DshAdapter,
  ZcodeAdapter,
} from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../../test/fixtures');

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('Phase 1 Multi-Client Adapters', () => {
  it('CodexAdapter parses rollout JSONL and aggregates turn usage', async () => {
    const adapter = new CodexAdapter({
      watchPaths: [path.join(fixturesDir, 'codex')],
    });
    const turns = await adapter.scanOnce();
    const completed = turns.find((t) => t.turnId === 'turn_codex_1');

    expect(completed).toBeDefined();
    expect(completed!.client).toBe('codex');
    expect(completed!.sessionId).toBe('codex-sess-01');
    expect(completed!.sourceMode).toBe('cli');
    expect(completed!.model).toBe('gpt-5-codex');
    expect(completed!.inputTokens).toBe(12400);
    expect(completed!.cachedTokens).toBe(9600);
    expect(completed!.reasoningTokens).toBe(120);
    expect(completed!.outputTokens).toBe(380);
    expect(completed!.totalTokens).toBe(12780);
    expect(completed!.status).toBe('completed');
    expect(completed!.toolCalls?.map((t) => t.name)).toContain('read_file');
  });

  it('ClaudeAdapter deduplicates streaming updates by message.id', async () => {
    const adapter = new ClaudeAdapter({
      watchPaths: [path.join(fixturesDir, 'claude')],
    });
    const turns = await adapter.scanOnce();
    expect(turns).toHaveLength(1);

    const turn = turns[0];
    expect(turn.client).toBe('claude');
    expect(turn.model).toBe('claude-sonnet-4-5');
    expect(turn.inputTokens).toBe(1800);
    expect(turn.cachedTokens).toBe(6400);
    expect(turn.cacheCreationTokens).toBe(400);
    // Must be 260 (final snapshot), NOT 120 + 260 = 380
    expect(turn.outputTokens).toBe(260);
    expect(turn.status).toBe('completed');
  });

  it('DshAdapter decompresses .jsonl.zstd and merges sub-agent calls', async () => {
    const tmp = await makeTempDir('tokenlens-dsh-');
    const sessDir = path.join(tmp, 'dsh-sess-01');
    await fs.mkdir(sessDir, { recursive: true });

    const rawJsonl = await fs.readFile(path.join(fixturesDir, 'dsh', 'session-01.jsonl'), 'utf8');
    await fs.writeFile(
      path.join(sessDir, 'session.jsonl.zstd'),
      zlib.zstdCompressSync(Buffer.from(rawJsonl, 'utf8')),
    );

    const adapter = new DshAdapter({ watchPaths: [tmp] });
    const turns = await adapter.scanOnce();
    expect(turns).toHaveLength(1);

    const turn = turns[0];
    expect(turn.client).toBe('dsh');
    expect(turn.model).toBe('deepseek-reasoner');
    expect(turn.inputTokens).toBe(5400);
    expect(turn.cachedTokens).toBe(4000);
    expect(turn.reasoningTokens).toBe(610);
    expect(turn.outputTokens).toBe(490);
    expect(turn.status).toBe('completed');
    expect(turn.subAgentCalls).toHaveLength(1);
    expect(turn.subAgentCalls[0].agentName).toBe('research');
    expect(turn.subAgentCalls[0].totalTokens).toBe(1420);
  });

  it('AntigravityAdapter groups USER_INPUT and PLANNER_RESPONSE steps', async () => {
    const adapter = new AntigravityAdapter({
      watchPaths: [path.join(fixturesDir, 'antigravity')],
    });
    const turns = await adapter.scanOnce();
    expect(turns).toHaveLength(1);

    const turn = turns[0];
    expect(turn.client).toBe('antigravity');
    expect(turn.usageAccuracy).toBe('estimated');
    expect(turn.status).toBe('completed');
    expect(turn.promptSummary).toContain('AntigravityAdapter');
    expect(turn.toolCalls?.map((t) => t.name)).toContain('list_dir');
    expect(turn.cachedTokens).toBeGreaterThanOrEqual(3500);
    expect(turn.totalTokens).toBeGreaterThan(0);
  });

  it('ZcodeAdapter queries turn_usage in read-only SQLite mode with project and archive metadata', async () => {
    const tmp = await makeTempDir('tokenlens-zcode-');
    const dbPath = path.join(tmp, 'db.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_archived INTEGER);
      CREATE TABLE model_usage (id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, model_id TEXT, started_at INTEGER);
      CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, data TEXT, time_created INTEGER);
      CREATE TABLE turn_usage (
        session_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        user_message_id TEXT,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        duration_ms INTEGER,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_input_tokens INTEGER NOT NULL DEFAULT 0,
        computed_total_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, turn_id)
      );
    `);
    db.prepare('INSERT INTO session (id, title, directory, time_archived) VALUES (?, ?, ?, ?)').run(
      'z-sess-1',
      'Zcode Demo',
      'D:\\workspace\\zcode-app',
      1700000000000,
    );
    db.prepare('INSERT INTO model_usage (id, session_id, turn_id, model_id, started_at) VALUES (?, ?, ?, ?, ?)').run(
      'mu_1',
      'z-sess-1',
      'turn_z_1',
      'glm-5',
      1000,
    );
    db.prepare('INSERT INTO part (id, message_id, data, time_created) VALUES (?, ?, ?, ?)').run(
      'p_1',
      'umsg_1',
      JSON.stringify({ text: 'Build ZcodeAdapter' }),
      1000,
    );
    db.prepare(
      `INSERT INTO turn_usage (
        session_id, turn_id, user_message_id, status, started_at, completed_at, duration_ms,
        input_tokens, output_tokens, reasoning_tokens, cache_creation_input_tokens, cache_read_input_tokens, computed_total_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('z-sess-1', 'turn_z_1', 'umsg_1', 'completed', 1000, 3500, 2500, 4200, 310, 80, 0, 2900, 4510);
    db.close();

    const adapter = new ZcodeAdapter({ watchPaths: [dbPath] });
    const turns = await adapter.scanOnce();
    expect(turns).toHaveLength(1);

    const turn = turns[0];
    expect(turn.client).toBe('zcode');
    expect(turn.sessionTitle).toBe('Zcode Demo');
    expect(turn.projectName).toBe('zcode-app');
    expect(turn.archived).toBe(true);
    expect(turn.archivedAt).toBe(1700000000000);
    expect(turn.model).toBe('glm-5');
    expect(turn.promptSummary).toBe('Build ZcodeAdapter');
    expect(turn.inputTokens).toBe(4200);
    expect(turn.cachedTokens).toBe(2900);
    expect(turn.reasoningTokens).toBe(80);
    expect(turn.outputTokens).toBe(310);
    expect(turn.totalTokens).toBe(4510);
    expect(turn.durationMs).toBe(2500);
    expect(turn.status).toBe('completed');
  });
});
