import { EventEmitter } from 'node:events';
import type { AdapterHealth, AdapterOptions, ClientType, UnifiedTurnUsage } from './types.js';
import { TurnAggregator } from './aggregator.js';

export interface AdapterEvents {
  turn: [turn: UnifiedTurnUsage];
  error: [error: Error];
  health: [health: AdapterHealth];
}

export abstract class BaseLogAdapter extends EventEmitter {
  abstract readonly client: ClientType;
  protected readonly options: AdapterOptions;
  protected readonly aggregator = new TurnAggregator();
  protected running = false;

  constructor(options: AdapterOptions = {}) {
    super();
    this.options = options;
  }

  abstract getDefaultPaths(): string[];

  abstract start(): Promise<void>;

  abstract stop(): Promise<void>;

  abstract scanOnce(): Promise<UnifiedTurnUsage[]>;

  abstract checkHealth(): Promise<AdapterHealth>;

  getTurns(sessionId?: string): UnifiedTurnUsage[] {
    return this.aggregator.getTurns(this.client, sessionId);
  }

  onTurnUpdate(listener: (turn: UnifiedTurnUsage) => void): () => void {
    this.on('turn', listener);
    return () => this.off('turn', listener);
  }

  protected emitTurn(turn: UnifiedTurnUsage): void {
    this.emit('turn', turn);
  }

  protected emitError(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    this.emit('error', error);
  }
}
