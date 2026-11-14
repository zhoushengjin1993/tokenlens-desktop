import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

export interface ReplayOptions {
  fixturesDir: string;
  targetDir: string;
  intervalMs?: number;
  onLine?: (client: string, lineIndex: number) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Replays static golden log fixtures into a temporary directory at a fixed interval
 * (default 500ms/line) to simulate live streaming Agent turns.
 */
export class LogReplaySimulator {
  private stopped = false;

  stop(): void {
    this.stopped = true;
  }

  async replayAll(options: ReplayOptions): Promise<void> {
    this.stopped = false;
    const intervalMs = options.intervalMs ?? 500;

    await fs.mkdir(options.targetDir, { recursive: true });

    const tasks: Array<Promise<void>> = [
      this.replayJsonl(
        'codex',
        path.join(options.fixturesDir, 'codex', 'session-01.jsonl'),
        path.join(options.targetDir, 'codex', 'rollout-sim.jsonl'),
        intervalMs,
        options.onLine,
      ),
      this.replayJsonl(
        'claude',
        path.join(options.fixturesDir, 'claude', 'session-01.jsonl'),
        path.join(options.targetDir, 'claude', 'proj-sim', 'session-01.jsonl'),
        intervalMs,
        options.onLine,
      ),
      this.replayJsonl(
        'antigravity',
        path.join(
          options.fixturesDir,
          'antigravity',
          'conv-01',
          '.system_generated',
          'logs',
          'transcript.jsonl',
        ),
        path.join(
          options.targetDir,
          'antigravity',
          'conv-sim-01',
          '.system_generated',
          'logs',
          'transcript.jsonl',
        ),
        intervalMs,
        options.onLine,
      ),
      this.replayZstd(
        'dsh',
        path.join(options.fixturesDir, 'dsh', 'session-01.jsonl'),
        path.join(options.targetDir, 'dsh', 'dsh-sim-01', 'session.jsonl.zstd'),
        intervalMs,
        options.onLine,
      ),
    ];

    await Promise.all(tasks);
  }

  private async replayJsonl(
    client: string,
    srcFile: string,
    destFile: string,
    intervalMs: number,
    onLine?: (client: string, lineIndex: number) => void,
  ): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(srcFile, 'utf8');
    } catch {
      return;
    }

    await fs.mkdir(path.dirname(destFile), { recursive: true });
    await fs.writeFile(destFile, '', 'utf8');

    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      if (this.stopped) break;
      await fs.appendFile(destFile, `${lines[i]}\n`, 'utf8');
      onLine?.(client, i + 1);
      await sleep(intervalMs);
    }
  }

  private async replayZstd(
    client: string,
    srcJsonl: string,
    destZstd: string,
    intervalMs: number,
    onLine?: (client: string, lineIndex: number) => void,
  ): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(srcJsonl, 'utf8');
    } catch {
      return;
    }

    await fs.mkdir(path.dirname(destZstd), { recursive: true });
    const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
    let accumulated = '';

    for (let i = 0; i < lines.length; i++) {
      if (this.stopped) break;
      accumulated += `${lines[i]}\n`;
      const compressed = zlib.zstdCompressSync(Buffer.from(accumulated, 'utf8'));
      await fs.writeFile(destZstd, compressed);
      onLine?.(client, i + 1);
      await sleep(intervalMs);
    }
  }
}
