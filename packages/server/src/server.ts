import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  type AdapterHealth,
  type AdapterOptions,
  type BaseLogAdapter,
  type ClientType,
  type UnifiedTurnUsage,
} from '@tokenlens/core';
import { createAllAdapters } from '@tokenlens/adapters';
import { LogReplaySimulator } from '@tokenlens/simulator';
import { handleMcpRequest, type JsonRpcRequest } from './mcp-server.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  adapterOverrides?: Partial<Record<ClientType, AdapterOptions>>;
  fixturesDir?: string;
  replayTempDir?: string;
  staticDir?: string;
}

export type WsMessage =
  | {
      type: 'init';
      turns: UnifiedTurnUsage[];
      health: AdapterHealth[];
      activeClient: ClientType | null;
    }
  | {
      type: 'turn:update';
      turn: UnifiedTurnUsage;
      activeClient: ClientType;
    }
  | {
      type: 'health:update';
      health: AdapterHealth[];
    };

export class TokenLensServer {
  private readonly port: number;
  private readonly host: string;
  private readonly adapters: BaseLogAdapter[];
  private readonly turns = new Map<string, UnifiedTurnUsage>();
  private readonly options: ServerOptions;
  private activeClient: ClientType | null = null;
  private healthCache: AdapterHealth[] = [];
  private httpServer: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private simulator: LogReplaySimulator | null = null;

  constructor(options: ServerOptions = {}) {
    this.options = options;
    this.port = options.port ?? 4789;
    this.host = options.host ?? '127.0.0.1';
    this.adapters = createAllAdapters(options.adapterOverrides);
  }

  private turnKey(t: UnifiedTurnUsage): string {
    return `${t.client}::${t.sessionId}::${t.turnId}`;
  }

  private getSortedTurns(): UnifiedTurnUsage[] {
    return Array.from(this.turns.values()).sort((a, b) => a.startedAt - b.startedAt);
  }

  getTurnsByClient(client?: ClientType): UnifiedTurnUsage[] {
    const sorted = this.getSortedTurns();
    return client ? sorted.filter((t) => t.client === client) : sorted;
  }

  private broadcast(msg: WsMessage): void {
    if (!this.wss) return;
    const payload = JSON.stringify(msg);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  async refreshHealth(): Promise<AdapterHealth[]> {
    this.healthCache = await Promise.all(this.adapters.map((a) => a.checkHealth()));
    return this.healthCache;
  }

  async start(): Promise<{ port: number; host: string }> {
    await this.refreshHealth();

    for (const adapter of this.adapters) {
      adapter.onTurnUpdate((turn) => {
        this.turns.set(this.turnKey(turn), turn);
        this.activeClient = turn.client;
        this.broadcast({
          type: 'turn:update',
          turn,
          activeClient: this.activeClient,
        });
      });

      await adapter.start();
      for (const t of adapter.getTurns()) {
        this.turns.set(this.turnKey(t), t);
      }
    }

    const sorted = this.getSortedTurns();
    if (sorted.length > 0) {
      const latest = sorted.reduce((acc, cur) => (cur.updatedAt > acc.updatedAt ? cur : acc));
      this.activeClient = latest.client;
    }

    this.httpServer = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url ?? '/';
      if (req.method === 'GET' && url === '/api/health') {
        const health = await this.refreshHealth();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ health }));
        return;
      }

      if (req.method === 'GET' && url === '/api/turns') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            turns: this.getSortedTurns(),
            activeClient: this.activeClient,
          }),
        );
        return;
      }

      if (req.method === 'POST' && url === '/api/sim/start') {
        if (!this.options.fixturesDir || !this.options.replayTempDir) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Simulator directories not configured' }));
          return;
        }
        this.simulator?.stop();
        this.simulator = new LogReplaySimulator();
        void this.simulator.replayAll({
          fixturesDir: this.options.fixturesDir,
          targetDir: this.options.replayTempDir,
          intervalMs: 450,
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'POST' && url === '/mcp') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        try {
          const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as JsonRpcRequest;
          const rpcRes = handleMcpRequest(rpc, {
            getTurns: (client) => this.getTurnsByClient(client),
          });
          res.writeHead(rpcRes ? 200 : 204, { 'Content-Type': 'application/json' });
          if (rpcRes) res.end(JSON.stringify(rpcRes));
          else res.end();
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        }
        return;
      }

      if (req.method === 'GET' && this.options.staticDir) {
        const served = await this.tryServeStatic(url, res);
        if (served) return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    this.wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
    this.wss.on('connection', (socket) => {
      const initMsg: WsMessage = {
        type: 'init',
        turns: this.getSortedTurns(),
        health: this.healthCache,
        activeClient: this.activeClient,
      };
      socket.send(JSON.stringify(initMsg));
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.port, this.host, () => resolve());
    });

    const addr = this.httpServer.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
    return { port: actualPort, host: this.host };
  }

  private async tryServeStatic(reqUrl: string, res: http.ServerResponse): Promise<boolean> {
    if (!this.options.staticDir) return false;
    const cleanPath = reqUrl.split('?')[0];
    const relPath = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
    const resolved = path.resolve(this.options.staticDir, relPath);
    const rootResolved = path.resolve(this.options.staticDir);
    if (!resolved.startsWith(rootResolved)) return false;

    const mimeMap: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
    };

    try {
      const data = await fs.readFile(resolved);
      const ext = path.extname(resolved);
      res.writeHead(200, { 'Content-Type': mimeMap[ext] ?? 'application/octet-stream' });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    this.simulator?.stop();
    await Promise.all(this.adapters.map((a) => a.stop()));
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve) => this.httpServer!.close(() => resolve()));
      this.httpServer = null;
    }
  }
}

export function createSimOverrides(replayTempDir: string): Partial<Record<ClientType, AdapterOptions>> {
  return {
    codex: { watchPaths: [path.join(replayTempDir, 'codex')] },
    zcode: { watchPaths: [path.join(replayTempDir, 'zcode', 'db.sqlite')] },
    claude: { watchPaths: [path.join(replayTempDir, 'claude')] },
    dsh: { watchPaths: [path.join(replayTempDir, 'dsh')] },
    antigravity: { watchPaths: [path.join(replayTempDir, 'antigravity')] },
    cursor: { watchPaths: [path.join(replayTempDir, 'cursor')] },
  };
}
