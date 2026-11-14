import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AdapterHealth, ClientType } from './types.js';

export interface ClientPathSpec {
  client: ClientType;
  paths: string[];
}

export function getDefaultClientPaths(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): Record<ClientType, string[]> {
  const appData = env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming');

  const base: Record<ClientType, string[]> = {
    codex: [
      path.join(homeDir, '.codex', 'sessions'),
      path.join(homeDir, '.codex', 'state_5.sqlite'),
    ],
    zcode: [
      path.join(homeDir, '.zcode', 'cli', 'db', 'db.sqlite'),
      path.join(homeDir, '.zcode', 'v2', 'tasks-index.sqlite'),
    ],
    claude: [
      path.join(homeDir, '.claude', 'projects'),
      ...(platform === 'win32' ? [path.join(appData, 'Claude')] : []),
    ],
    dsh: [path.join(homeDir, '.dsh', 'sessions')],
    antigravity: [
      path.join(homeDir, '.gemini', 'antigravity', 'brain'),
      path.join(homeDir, '.gemini', 'antigravity', 'conversation_summaries.db'),
    ],
    cursor: [
      ...(platform === 'win32'
        ? [
            path.join(appData, 'Cursor', 'User', 'workspaceStorage'),
            path.join(appData, 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
          ]
        : platform === 'darwin'
          ? [
              path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'workspaceStorage'),
              path.join(homeDir, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
            ]
          : [
              path.join(homeDir, '.config', 'Cursor', 'User', 'workspaceStorage'),
              path.join(homeDir, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
            ]),
      path.join(homeDir, '.cursor', 'projects'),
    ],
  };

  return base;
}

export async function probePaths(paths: string[]): Promise<{ detected: string[]; errors: string[] }> {
  const detected: string[] = [];
  const errors: string[] = [];

  await Promise.all(
    paths.map(async (target) => {
      try {
        await fs.access(target, fs.constants.R_OK);
        detected.push(target);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code && code !== 'ENOENT') {
          errors.push(`${target}: ${code}`);
        }
      }
    }),
  );

  return { detected, errors };
}

export async function checkClientHealth(
  client: ClientType,
  candidatePaths?: string[],
): Promise<AdapterHealth> {
  const paths = candidatePaths ?? getDefaultClientPaths()[client];
  const { detected, errors } = await probePaths(paths);
  return {
    client,
    available: detected.length > 0,
    detectedPaths: detected,
    errors,
    checkedAt: Date.now(),
  };
}
