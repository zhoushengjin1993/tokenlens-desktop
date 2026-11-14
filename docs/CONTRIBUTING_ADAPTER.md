# 50 行代码贡献新客户端 Adapter 指南

TokenLens Desktop 将所有客户端日志解析收敛在 `@tokenlens/adapters` 中。你只需 **继承 `BaseLogAdapter`** 并向 `this.aggregator.ingest(...)` 投喂标准 `RawTurnFragment`，即可完成一个新客户端（如 Cline、Zed、OpenCode 等）的接入。

## 1. 新建 Adapter 文件

在 `packages/adapters/src/` 下新建 `<client>.ts`（例如 `cline.ts`）：

```ts
import chokidar, { type FSWatcher } from 'chokidar';
import { BaseLogAdapter, checkClientHealth, type AdapterHealth, type UnifiedTurnUsage } from '@tokenlens/core';
import { ByteOffsetTailer } from './utils/jsonl-tail.js';
import { findFiles } from './utils/fs-walk.js';

export class ClineAdapter extends BaseLogAdapter {
  readonly client = 'cline' as const; // 先在 @tokenlens/core types.ts 的 ClientType 中注册
  private readonly tailer = new ByteOffsetTailer();
  private watcher: FSWatcher | null = null;

  getDefaultPaths(): string[] {
    return this.options.watchPaths ?? [/* 你的默认日志路径 */];
  }

  async checkHealth(): Promise<AdapterHealth> {
    return checkClientHealth(this.client, this.options.watchPaths);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.scanOnce();
    this.watcher = chokidar.watch(this.getDefaultPaths(), { ignoreInitial: true });
    this.watcher.on('change', async (filePath) => {
      for (const turn of await this.processFile(filePath)) this.emitTurn(turn);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.watcher?.close();
  }

  async scanOnce(): Promise<UnifiedTurnUsage[]> {
    const files = await findFiles(this.getDefaultPaths(), (p) => p.endsWith('.jsonl'));
    const out: UnifiedTurnUsage[] = [];
    for (const f of files) out.push(...(await this.processFile(f)));
    return out;
  }

  private async processFile(filePath: string): Promise<UnifiedTurnUsage[]> {
    const lines = await this.tailer.readNewLines<any>(filePath);
    return lines.map((row) =>
      this.aggregator.ingest({
        client: this.client,
        sessionId: row.sessionId ?? 'default',
        turnId: row.turnId ?? 'turn_1',
        messageId: row.messageId,
        accountingMode: 'snapshot', // 支持 'snapshot' | 'delta' | 'cumulative'
        model: row.model,
        promptSummary: row.prompt ?? '',
        metrics: {
          inputTokens: row.inputTokens ?? 0,
          cachedTokens: row.cachedTokens ?? 0,
          reasoningTokens: row.reasoningTokens ?? 0,
          outputTokens: row.outputTokens ?? 0,
        },
        updatedAt: row.timestamp ?? Date.now(),
        status: row.done ? 'completed' : 'running',
      }),
    );
  }
}
```

## 2. 注册与测试

1. 在 `packages/core/src/types.ts` 的 `ClientType` 联合类型中加入你的客户端标识。
2. 在 `packages/adapters/src/index.ts` 的 `createAdapter` 中注册该 Adapter。
3. 在 `test/fixtures/<client>/` 下放入脱敏黄金样本，并在 `packages/adapters/test/adapters.test.ts` 补充单测后运行 `pnpm test`。
