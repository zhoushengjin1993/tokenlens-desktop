import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createSimOverrides, TokenLensServer, type WsMessage } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, '../../../test/fixtures');

let server: TokenLensServer | null = null;
let tmpDir: string | null = null;

afterEach(async () => {
  await server?.stop();
  server = null;
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
    tmpDir = null;
  }
});

describe('TokenLensServer realtime WebSocket', () => {
  it('pushes turn:update events within 500ms during LogReplaySimulator replay', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tokenlens-ws-'));
    server = new TokenLensServer({
      port: 0,
      fixturesDir,
      replayTempDir: tmpDir,
      adapterOverrides: createSimOverrides(tmpDir),
    });

    const { host, port } = await server.start();
    const ws = new WebSocket(`ws://${host}:${port}/ws`);

    const receivedUpdates: WsMessage[] = [];
    let gotInit = false;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for WS messages')), 6000);
      ws.on('message', async (raw) => {
        const msg = JSON.parse(raw.toString()) as WsMessage;
        if (msg.type === 'init') {
          gotInit = true;
          expect(msg.health).toHaveLength(5);
          await fetch(`http://${host}:${port}/api/sim/start`, { method: 'POST' });
        } else if (msg.type === 'turn:update') {
          receivedUpdates.push(msg);
          if (receivedUpdates.length >= 3) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
      ws.on('error', reject);
    });

    ws.close();
    expect(gotInit).toBe(true);
    expect(receivedUpdates.length).toBeGreaterThanOrEqual(3);

    const mcpRes = await fetch(`http://${host}:${port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_turn_usage_summary', arguments: { limit: 5, includeCost: true } },
      }),
    });
    expect(mcpRes.status).toBe(200);
    const mcpJson = (await mcpRes.json()) as {
      result: { structuredContent: { count: number; totalTokens: number } };
    };
    expect(mcpJson.result.structuredContent.count).toBeGreaterThan(0);
    expect(mcpJson.result.structuredContent.totalTokens).toBeGreaterThan(0);
  });
});
