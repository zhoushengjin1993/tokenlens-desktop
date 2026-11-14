import { create } from 'zustand';
import type { AdapterHealth, ClientType, UnifiedTurnUsage } from '@tokenlens/core';

export type UiState = 'pill' | 'drawer';

interface TokenStoreState {
  turns: Record<string, UnifiedTurnUsage>;
  health: AdapterHealth[];
  selectedClient: ClientType;
  autoSwitch: boolean;
  uiState: UiState;
  expandedTurnKey: string | null;
  showOnboarding: boolean;
  wsConnected: boolean;

  setInit: (turns: UnifiedTurnUsage[], health: AdapterHealth[], activeClient: ClientType | null) => void;
  upsertTurn: (turn: UnifiedTurnUsage, activeClient: ClientType) => void;
  setHealth: (health: AdapterHealth[]) => void;
  setSelectedClient: (client: ClientType) => void;
  toggleAutoSwitch: () => void;
  setUiState: (state: UiState) => void;
  toggleUiState: () => void;
  setExpandedTurnKey: (key: string | null) => void;
  setShowOnboarding: (show: boolean) => void;
  setWsConnected: (connected: boolean) => void;
}

export function turnCompositeKey(t: UnifiedTurnUsage): string {
  return `${t.client}::${t.sessionId}::${t.turnId}`;
}

export const useTokenStore = create<TokenStoreState>((set) => ({
  turns: {},
  health: [],
  selectedClient: 'codex',
  autoSwitch: true,
  uiState: 'drawer',
  expandedTurnKey: null,
  showOnboarding: false,
  wsConnected: false,

  setInit: (turns, health, activeClient) =>
    set((state) => {
      const map: Record<string, UnifiedTurnUsage> = {};
      for (const t of turns) map[turnCompositeKey(t)] = t;
      return {
        turns: map,
        health,
        selectedClient:
          state.autoSwitch && activeClient ? activeClient : state.selectedClient,
      };
    }),

  upsertTurn: (turn, activeClient) =>
    set((state) => ({
      turns: {
        ...state.turns,
        [turnCompositeKey(turn)]: turn,
      },
      selectedClient: state.autoSwitch ? activeClient : state.selectedClient,
    })),

  setHealth: (health) => set({ health }),
  setSelectedClient: (selectedClient) => set({ selectedClient }),
  toggleAutoSwitch: () => set((state) => ({ autoSwitch: !state.autoSwitch })),
  setUiState: (uiState) => set({ uiState }),
  toggleUiState: () =>
    set((state) => ({ uiState: state.uiState === 'pill' ? 'drawer' : 'pill' })),
  setExpandedTurnKey: (expandedTurnKey) =>
    set((state) => ({
      expandedTurnKey: state.expandedTurnKey === expandedTurnKey ? null : expandedTurnKey,
    })),
  setShowOnboarding: (showOnboarding) => set({ showOnboarding }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
}));
