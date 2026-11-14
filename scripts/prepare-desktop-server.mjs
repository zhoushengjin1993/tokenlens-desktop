import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outDir = path.join(repoRoot, 'apps', 'desktop', 'src-tauri', 'resources', 'server');
const outFile = path.join(outDir, 'cli.cjs');
const withNode = process.argv.includes('--with-node');

await fs.mkdir(outDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(repoRoot, 'packages', 'server', 'src', 'cli.ts')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: outFile,
  external: ['node:*'],
  logLevel: 'info',
});

if (withNode) {
  const exeName = process.platform === 'win32' ? 'node.exe' : 'node';
  const targetNode = path.join(outDir, exeName);
  await fs.copyFile(process.execPath, targetNode);
  console.log(`Copied Node runtime (${process.version}) -> ${targetNode}`);
}
