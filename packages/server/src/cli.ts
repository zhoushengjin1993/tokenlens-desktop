#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAllAdapters } from '@tokenlens/adapters';
import { createSimOverrides, TokenLensServer } from './server.js';
import { startStdioMcpServer } from './mcp-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const useSim = args.includes('--sim') || process.env.TOKENLENS_SIM === '1';
  const useMcpStdio = args.includes('--mcp');
  const portArg = args.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.split('=')[1]) : 4789;

  if (useMcpStdio) {
    const adapters = createAllAdapters();
    await Promise.all(adapters.map((a) => a.start()));
    startStdioMcpServer({
      getTurns: (client) => {
        const list = client
          ? adapters.filter((a) => a.client === client).flatMap((a) => a.getTurns())
          : adapters.flatMap((a) => a.getTurns());
        return list.sort((a, b) => a.startedAt - b.startedAt);
      },
    });
    return;
  }

  const fixturesDir = path.join(repoRoot, 'test', 'fixtures');
  const replayTempDir = path.join(repoRoot, '.tmp-replay');
  const webDistDir = path.join(repoRoot, 'apps', 'web', 'dist');
  const staticDir = (await exists(webDistDir)) ? webDistDir : undefined;

  if (useSim) {
    await fs.rm(replayTempDir, { recursive: true, force: true });
    await fs.mkdir(replayTempDir, { recursive: true });
  }

  const server = new TokenLensServer({
    port,
    fixturesDir,
    replayTempDir,
    staticDir,
    adapterOverrides: useSim ? createSimOverrides(replayTempDir) : undefined,
  });

  const info = await server.start();
  console.log(`TokenLens listening on http://${info.host}:${info.port} (sim=${useSim}, mcp=/mcp)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
