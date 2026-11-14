import fs from 'node:fs/promises';
import path from 'node:path';

export async function findFiles(
  roots: string[],
  predicate: (filePath: string) => boolean,
): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && predicate(fullPath)) {
        results.push(fullPath);
      }
    }
  }

  for (const root of roots) {
    try {
      const stat = await fs.stat(root);
      if (stat.isFile()) {
        if (predicate(root)) results.push(root);
      } else if (stat.isDirectory()) {
        await walk(root);
      }
    } catch {
      // Ignore missing roots
    }
  }

  return results;
}

export function truncatePrompt(text: string, maxLen = 120): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}
