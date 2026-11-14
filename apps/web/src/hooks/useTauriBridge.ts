import { useEffect } from 'react';
import { useTokenStore } from '../stores/useTokenStore';

interface TauriInternals {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
  transformCallback?: unknown;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: TauriInternals;
    __TAURI__?: {
      core?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
      event?: {
        listen: (event: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
      };
    };
  }
}

export function isTauriEnv(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
}

export function useTauriBridge(): void {
  const uiState = useTokenStore((s) => s.uiState);
  const toggleUiState = useTokenStore((s) => s.toggleUiState);

  useEffect(() => {
    if (!isTauriEnv()) return;
    document.documentElement.classList.add('tauri-transparent');
    const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    void invoke?.('set_pill_mode', { isPill: uiState === 'pill' });
  }, [uiState]);

  useEffect(() => {
    if (!isTauriEnv() || !window.__TAURI__?.event?.listen) return;
    let unlisten: (() => void) | undefined;

    void window.__TAURI__.event
      .listen('tokenlens://toggle-drawer', () => {
        toggleUiState();
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      unlisten?.();
    };
  }, [toggleUiState]);
}
