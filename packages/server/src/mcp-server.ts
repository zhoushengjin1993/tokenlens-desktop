import readline from 'node:readline';
import {
  calculateTurnCost,
  detectTokenSpike,
  type ClientType,
  type UnifiedTurnUsage,
} from '@tokenlens/core';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface McpToolContext {
  getTurns: (client?: ClientType) => UnifiedTurnUsage[];
}

export const MCP_TOOLS = [
  {
    name: 'get_turn_usage_summary',
    description:
      'Get per-turn AI Agent token usage, cache savings, and spike alerts across Codex, Zcode, Claude, DSH, and Antigravity.',
    inputSchema: {
      type: 'object',
      properties: {
        client: {
          type: 'string',
          enum: ['codex', 'zcode', 'claude', 'dsh', 'antigravity'],
          description: 'Optional client filter',
        },
        limit: {
          type: 'number',
          description: 'Max number of recent turns to return (default 10)',
        },
        includeCost: {
          type: 'boolean',
          description: 'Include USD cost and cache savings breakdown (default true)',
        },
      },
    },
  },
];

export function handleMcpRequest(req: JsonRpcRequest, ctx: McpToolContext): JsonRpcResponse | null {
  const id = req.id ?? null;

  if (req.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'tokenlens-mcp', version: '0.1.0' },
      },
    };
  }

  if (req.method === 'notifications/initialized') {
    return null;
  }

  if (req.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS },
    };
  }

  if (req.method === 'tools/call') {
    const params = req.params ?? {};
    const name = params.name;
    const args = (params.arguments ?? {}) as {
      client?: ClientType;
      limit?: number;
      includeCost?: boolean;
    };

    if (name !== 'get_turn_usage_summary') {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${String(name)}` },
      };
    }

    const limit = Math.max(1, Math.min(100, Number(args.limit ?? 10)));
    const includeCost = args.includeCost ?? true;
    const allTurns = ctx.getTurns(args.client);
    const recent = allTurns.slice(-limit);

    let totalTokens = 0;
    let totalCacheSavingsUsd = 0;
    const enriched = recent.map((t) => {
      totalTokens += t.totalTokens;
      const cost = includeCost ? calculateTurnCost(t) : undefined;
      if (cost) totalCacheSavingsUsd += cost.cacheSavingsUsd;
      const spike = detectTokenSpike(t);
      return {
        client: t.client,
        sessionId: t.sessionId,
        turnIndex: t.turnIndex,
        model: t.model,
        status: t.status,
        usageAccuracy: t.usageAccuracy,
        inputTokens: t.inputTokens,
        cachedTokens: t.cachedTokens,
        reasoningTokens: t.reasoningTokens,
        outputTokens: t.outputTokens,
        totalTokens: t.totalTokens,
        durationMs: t.durationMs,
        ...(cost ? { totalCostUsd: cost.totalCostUsd, cacheSavingsUsd: cost.cacheSavingsUsd } : {}),
        ...(spike.isSpike ? { spikeAlert: spike } : {}),
      };
    });

    const summary = {
      count: enriched.length,
      totalTokens,
      ...(includeCost ? { totalCacheSavingsUsd: Number(totalCacheSavingsUsd.toFixed(6)) } : {}),
      turns: enriched,
    };

    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
        structuredContent: summary,
      },
    };
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${req.method}` },
  };
}

export function startStdioMcpServer(ctx: McpToolContext): void {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const req = JSON.parse(trimmed) as JsonRpcRequest;
      const res = handleMcpRequest(req, ctx);
      if (res) process.stdout.write(`${JSON.stringify(res)}\n`);
    } catch {
      process.stdout.write(
        `${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`,
      );
    }
  });
}
