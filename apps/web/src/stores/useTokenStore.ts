import { create } from 'zustand';
import type { AdapterHealth, ClientType, UnifiedTurnUsage } from '@tokenlens/core';

export type UiState = 'pill' | 'drawer';
export type ViewMode = 'active' | 'archived';
export type TimeRange = 'all' | 'today';

const SPIKE_STORAGE_KEY = 'tokenlens_spike_threshold';

function loadInitialSpikeThreshold(): number {
  try {
    const raw = window.localStorage.getItem(SPIKE_STORAGE_KEY);
    const num = raw ? Number(raw) : NaN;
    if (Number.isFinite(num) && num >= 10_000) return num;
  } catch {
    // Ignore storage error
  }
  return 50_000;
}

interface TokenStoreState {
  turns: Record<string, UnifiedTurnUsage>;
  health: AdapterHealth[];
  selectedClient: ClientType;
  viewMode: ViewMode;
  timeRange: TimeRange;
  onlySpikes: boolean;
  spikeThreshold: number;
  selectedProjectId: string | null;
  selectedSessionId: string | null;
  autoSwitch: boolean;
  uiState: UiState;
  expandedTurnKey: string | null;
  showOnboarding: boolean;
  showSettings: boolean;
  showCost: boolean;
  wsConnected: boolean;

  setInit: (turns: UnifiedTurnUsage[], health: AdapterHealth[], activeClient: ClientType | null) => void;
  upsertTurn: (turn: UnifiedTurnUsage, activeClient: ClientType) => void;
  setHealth: (health: AdapterHealth[]) => void;
  setSelectedClient: (client: ClientType) => void;
  setViewMode: (mode: ViewMode) => void;
  setTimeRange: (range: TimeRange) => void;
  toggleOnlySpikes: () => void;
  setSpikeThreshold: (threshold: number) => void;
  selectProject: (projectId: string | null) => void;
  selectSession: (sessionId: string | null) => void;
  goRoot: () => void;
  toggleAutoSwitch: () => void;
  toggleShowCost: () => void;
  setUiState: (state: UiState) => void;
  toggleUiState: () => void;
  setExpandedTurnKey: (key: string | null) => void;
  setShowOnboarding: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setWsConnected: (connected: boolean) => void;
}

export function turnCompositeKey(t: UnifiedTurnUsage): string {
  return `${t.client}::${t.sessionId}::${t.turnId}`;
}

export const useTokenStore = create<TokenStoreState>((set) => ({
  turns: {},
  health: [],
  selectedClient: 'codex',
  viewMode: 'active',
  timeRange: 'all',
  onlySpikes: false,
  spikeThreshold: loadInitialSpikeThreshold(),
  selectedProjectId: null,
  selectedSessionId: null,
  autoSwitch: true,
  uiState: 'drawer',
  expandedTurnKey: null,
  showOnboarding: false,
  showSettings: false,
  showCost: true,
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
      ...(state.autoSwitch
        ? {
            selectedClient: activeClient,
            viewMode: turn.archived ? 'archived' : 'active',
            selectedProjectId: turn.archived ? null : turn.projectId,
            selectedSessionId: turn.sessionId,
          }
        : {}),
    })),

  setHealth: (health) => set({ health }),
  setSelectedClient: (selectedClient) =>
    set({
      selectedClient,
      selectedProjectId: null,
      selectedSessionId: null,
      expandedTurnKey: null,
    }),
  setViewMode: (viewMode) =>
    set({
      viewMode,
      selectedProjectId: null,
      selectedSessionId: null,
      expandedTurnKey: null,
    }),
  setTimeRange: (timeRange) =>
    set({
      timeRange,
      selectedProjectId: null,
      selectedSessionId: null,
      expandedTurnKey: null,
    }),
  toggleOnlySpikes: () =>
    set((state) => ({
      onlySpikes: !state.onlySpikes,
      expandedTurnKey: null,
    })),
  setSpikeThreshold: (spikeThreshold) => {
    try {
      window.localStorage.setItem(SPIKE_STORAGE_KEY, String(spikeThreshold));
    } catch {
      // Ignore storage error
    }
    set({ spikeThreshold });
  },
  selectProject: (selectedProjectId) =>
    set({
      selectedProjectId,
      selectedSessionId: null,
      expandedTurnKey: null,
    }),
  selectSession: (selectedSessionId) =>
    set({
      selectedSessionId,
      expandedTurnKey: null,
    }),
  goRoot: () =>
    set({
      selectedProjectId: null,
      selectedSessionId: null,
      expandedTurnKey: null,
    }),
  toggleAutoSwitch: () => set((state) => ({ autoSwitch: !state.autoSwitch })),
  toggleShowCost: () => set((state) => ({ showCost: !state.showCost })),
  setUiState: (uiState) => set({ uiState }),
  toggleUiState: () =>
    set((state) => ({ uiState: state.uiState === 'pill' ? 'drawer' : 'pill' })),
  setExpandedTurnKey: (expandedTurnKey) =>
    set((state) => ({
      expandedTurnKey: state.expandedTurnKey === expandedTurnKey ? null : expandedTurnKey,
    })),
  setShowOnboarding: (showOnboarding) =>
    set({ showOnboarding, ...(showOnboarding ? { showSettings: false } : {}) }),
  setShowSettings: (showSettings) =>
    set({ showSettings, ...(showSettings ? { showOnboarding: false } : {}) }),
  setWsConnected: (wsConnected) => set({ wsConnected }),
}));
