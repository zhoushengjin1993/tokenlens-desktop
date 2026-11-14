import { create } from 'zustand';
import type { AdapterHealth, ClientType, UnifiedTurnUsage } from '@tokenlens/core';
import { ALL_CLIENTS } from '../utils/format';

export type UiState = 'pill' | 'drawer';
export type ViewMode = 'active' | 'archived';
export type TimeRange = 'all' | 'today';

const SPIKE_STORAGE_KEY = 'tokenlens_spike_threshold';
const ENABLED_CLIENTS_KEY = 'tokenlens_enabled_clients';
const PROJECT_NAMES_KEY = 'tokenlens_project_names';

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

function loadInitialEnabledClients(): ClientType[] {
  try {
    const raw = window.localStorage.getItem(ENABLED_CLIENTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((c): c is ClientType =>
          ALL_CLIENTS.includes(c as ClientType),
        );
        if (valid.length > 0) return valid;
      }
    }
  } catch {
    // Ignore storage error
  }
  return [...ALL_CLIENTS];
}

function loadInitialProjectNames(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(PROJECT_NAMES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, string>;
      }
    }
  } catch {
    // Ignore storage error
  }
  return {};
}

interface TokenStoreState {
  turns: Record<string, UnifiedTurnUsage>;
  health: AdapterHealth[];
  enabledClients: ClientType[];
  projectNameOverrides: Record<string, string>;
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
  toggleClientEnabled: (client: ClientType) => void;
  setProjectNameOverride: (projectId: string, name: string) => void;
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

const initialEnabledClients = loadInitialEnabledClients();

export const useTokenStore = create<TokenStoreState>((set) => ({
  turns: {},
  health: [],
  enabledClients: initialEnabledClients,
  projectNameOverrides: loadInitialProjectNames(),
  selectedClient: initialEnabledClients[0] ?? 'codex',
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
      const canAuto =
        state.autoSwitch && activeClient && state.enabledClients.includes(activeClient);
      return {
        turns: map,
        health,
        selectedClient: canAuto ? activeClient : state.selectedClient,
      };
    }),

  upsertTurn: (turn, activeClient) =>
    set((state) => {
      const canAuto = state.autoSwitch && state.enabledClients.includes(activeClient);
      return {
        turns: {
          ...state.turns,
          [turnCompositeKey(turn)]: turn,
        },
        ...(canAuto
          ? {
              selectedClient: activeClient,
              viewMode: turn.archived ? 'archived' : 'active',
              selectedProjectId: turn.archived ? null : turn.projectId,
              selectedSessionId: turn.sessionId,
            }
          : {}),
      };
    }),

  setHealth: (health) => set({ health }),
  toggleClientEnabled: (client) =>
    set((state) => {
      const exists = state.enabledClients.includes(client);
      if (exists && state.enabledClients.length <= 1) {
        return state; // Keep at least 1 tool visible
      }
      const next = exists
        ? state.enabledClients.filter((c) => c !== client)
        : ALL_CLIENTS.filter((c) => c === client || state.enabledClients.includes(c));
      try {
        window.localStorage.setItem(ENABLED_CLIENTS_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage error
      }
      const nextSelected = next.includes(state.selectedClient) ? state.selectedClient : next[0];
      return {
        enabledClients: next,
        selectedClient: nextSelected,
        ...(nextSelected !== state.selectedClient
          ? { selectedProjectId: null, selectedSessionId: null, expandedTurnKey: null }
          : {}),
      };
    }),
  setProjectNameOverride: (projectId, name) =>
    set((state) => {
      const trimmed = name.trim();
      const next = { ...state.projectNameOverrides };
      if (trimmed) {
        next[projectId] = trimmed;
      } else {
        delete next[projectId];
      }
      try {
        window.localStorage.setItem(PROJECT_NAMES_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage error
      }
      return { projectNameOverrides: next };
    }),
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
