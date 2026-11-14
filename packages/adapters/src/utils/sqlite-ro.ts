import { DatabaseSync } from 'node:sqlite';

/**
 * Opens a SQLite database in strict read-only mode with a busy timeout
 * to avoid SQLITE_BUSY lock conflicts with active agent processes.
 */
export function openReadOnlySqlite(dbPath: string, timeoutMs = 3000): DatabaseSync {
  return new DatabaseSync(dbPath, {
    readOnly: true,
    timeout: timeoutMs,
  });
}

export function isSqliteBusyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('SQLITE_BUSY') || msg.includes('database is locked');
}
