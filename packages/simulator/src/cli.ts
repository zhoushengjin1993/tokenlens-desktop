import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAllAdapters } from '@tokenlens/adapters';
import { LogReplaySimulator } from './simulator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const fixturesDir = path.join(repoRoot, 'test', 'fixtures');
const targetDir = path.join(repoRoot, '.tmp-replay');

async function main() {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });

  const adapters = createAllAdapters({
    codex: { watchPaths: [path.join(targetDir, 'codex')] },
    zcode: { watchPaths: [path.join(targetDir, 'zcode', 'db.sqlite')] },
    claude: { watchPaths: [path.join(targetDir, 'claude')] },
    dsh: { watchPaths: [path.join(targetDir, 'dsh')] },
    antigravity: { watchPaths: [path.join(targetDir, 'antigravity')] },
  });

  for (const adapter of adapters) {
    adapter.onTurnUpdate((turn) => {
      console.log(JSON.stringify(turn));
    });
    await adapter.start();
  }

  const sim = new LogReplaySimulator();
  await sim.replayAll({
    fixturesDir,
    targetDir,
    intervalMs: 200,
  });

  // Allow final debounce cycles (e.g. DSH 500ms) to flush
  await new Promise((r) => setTimeout(r, 800));
  for (const adapter of adapters) {
    await adapter.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
