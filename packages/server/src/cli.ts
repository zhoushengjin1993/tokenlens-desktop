import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimOverrides, TokenLensServer } from './server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

async function main() {
  const args = process.argv.slice(2);
  const useSim = args.includes('--sim') || process.env.TOKENLENS_SIM === '1';
  const portArg = args.find((a) => a.startsWith('--port='));
  const port = portArg ? Number(portArg.split('=')[1]) : 4789;

  const fixturesDir = path.join(repoRoot, 'test', 'fixtures');
  const replayTempDir = path.join(repoRoot, '.tmp-replay');

  if (useSim) {
    await fs.rm(replayTempDir, { recursive: true, force: true });
    await fs.mkdir(replayTempDir, { recursive: true });
  }

  const server = new TokenLensServer({
    port,
    fixturesDir,
    replayTempDir,
    adapterOverrides: useSim ? createSimOverrides(replayTempDir) : undefined,
  });

  const info = await server.start();
  console.log(`TokenLens Server listening on http://${info.host}:${info.port} (sim=${useSim})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
