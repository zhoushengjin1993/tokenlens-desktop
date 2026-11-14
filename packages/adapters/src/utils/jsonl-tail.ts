import fs from 'node:fs/promises';

interface FileCursor {
  offset: number;
  remainder: string;
}

/**
 * Incrementally reads newly appended JSONL lines from files using byte offsets.
 * Handles file truncation/rotation and partial trailing lines safely.
 */
export class ByteOffsetTailer {
  private readonly cursors = new Map<string, FileCursor>();

  async readNewLines<T = Record<string, unknown>>(filePath: string): Promise<T[]> {
    let stat;
    try {
      stat = await fs.stat(filePath);
    } catch {
      return [];
    }

    let cursor = this.cursors.get(filePath);
    if (!cursor || stat.size < cursor.offset) {
      cursor = { offset: 0, remainder: '' };
      this.cursors.set(filePath, cursor);
    }

    if (stat.size === cursor.offset) {
      return [];
    }

    const bytesToRead = stat.size - cursor.offset;
    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.allocUnsafe(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, cursor.offset);
      cursor.offset += bytesRead;

      const chunk = cursor.remainder + buffer.subarray(0, bytesRead).toString('utf8');
      const lines = chunk.split(/\r?\n/);
      cursor.remainder = lines.pop() ?? '';

      const parsed: T[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          parsed.push(JSON.parse(trimmed) as T);
        } catch {
          // Ignore malformed/partial JSON lines
        }
      }
      return parsed;
    } finally {
      await handle.close();
    }
  }

  reset(filePath?: string): void {
    if (filePath) {
      this.cursors.delete(filePath);
    } else {
      this.cursors.clear();
    }
  }
}
