import { useEffect } from 'react';
import type { AdapterHealth, ClientType, UnifiedTurnUsage } from '@tokenlens/core';
import { useTokenStore } from '../stores/useTokenStore';
import { isTauriEnv } from './useTauriBridge';

type IncomingMessage =
  | { type: 'init'; turns: UnifiedTurnUsage[]; health: AdapterHealth[]; activeClient: ClientType | null }
  | { type: 'turn:update'; turn: UnifiedTurnUsage; activeClient: ClientType }
  | { type: 'health:update'; health: AdapterHealth[] };

export function apiBaseUrl(): string {
  return isTauriEnv() ? 'http://127.0.0.1:4789' : '';
}

export function useTokenStream(): void {
  const setInit = useTokenStore((s) => s.setInit);
  const upsertTurn = useTokenStore((s) => s.upsertTurn);
  const setHealth = useTokenStore((s) => s.setHealth);
  const setWsConnected = useTokenStore((s) => s.setWsConnected);
  const toggleUiState = useTokenStore((s) => s.toggleUiState);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        toggleUiState();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleUiState]);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      const wsUrl = isTauriEnv()
        ? 'ws://127.0.0.1:4789/ws'
        : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) {
          reconnectTimer = window.setTimeout(connect, 1500);
        }
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as IncomingMessage;
          if (msg.type === 'init') {
            setInit(msg.turns, msg.health, msg.activeClient);
          } else if (msg.type === 'turn:update') {
            upsertTurn(msg.turn, msg.activeClient);
          } else if (msg.type === 'health:update') {
            setHealth(msg.health);
          }
        } catch {
          // Ignore malformed WS frames
        }
      };
    };

    connect();
    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [setHealth, setInit, setWsConnected, upsertTurn]);
}
