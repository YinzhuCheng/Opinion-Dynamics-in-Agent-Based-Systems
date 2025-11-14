import { produce } from 'immer';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import type {
  AgentSpec,
  Message,
  ModelConfig,
  Persona,
  RunConfig,
  RunState,
  SessionResult,
  SentimentSetting,
  Vendor,
  DialogueMode,
  RunStatus,
} from '../types';

const defaultModelConfig: ModelConfig = {
  vendor: 'openai',
  baseUrl: '',
  apiKey: '',
  model: 'gpt-4o',
};

const defaultPersona: Persona = {
  type: 'free',
  description: 'A neutral analyst focused on balanced arguments.',
};

const createDefaultAgents = (): AgentSpec[] => [
  {
    id: nanoid(),
    name: 'A1',
    persona: { ...defaultPersona },
    initialOpinion: '',
  },
  {
    id: nanoid(),
    name: 'A2',
    persona: { ...defaultPersona, description: 'A challenger who questions assumptions.' },
    initialOpinion: '',
  },
];

const clampTrustWeight = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  if (value === 0) return 0;
  return Math.min(1, Math.max(0, value));
};

const createIdentityMatrix = (size: number): number[][] =>
  Array.from({ length: size }, (_, rowIndex) =>
    Array.from({ length: size }, (_, colIndex) => (rowIndex === colIndex ? 1 : 0)),
  );

const createUniformMatrix = (size: number): number[][] => {
  if (size === 0) return [];
  const weight = 1 / size;
  return Array.from({ length: size }, () => Array.from({ length: size }, () => weight));
};

const rebuildTrustMatrix = (
  matrix: number[][] | undefined,
  prevAgents: AgentSpec[],
  nextAgents: AgentSpec[],
): number[][] => {
  const size = nextAgents.length;
  if (size === 0) {
    return [];
  }
  if (!matrix || prevAgents.length === 0) {
    return createIdentityMatrix(size);
  }
  const result = Array.from({ length: size }, () => Array(size).fill(0));
  const prevIndexMap = new Map(prevAgents.map((agent, index) => [agent.id, index]));
  for (let row = 0; row < size; row += 1) {
    const nextRowAgentId = nextAgents[row]?.id;
    const prevRowIdx = nextRowAgentId ? prevIndexMap.get(nextRowAgentId) : undefined;
    for (let col = 0; col < size; col += 1) {
      const nextColAgentId = nextAgents[col]?.id;
      const prevColIdx = nextColAgentId ? prevIndexMap.get(nextColAgentId) : undefined;
      let weight = row === col ? 1 : 0;
      if (
        prevRowIdx !== undefined &&
        prevColIdx !== undefined &&
        typeof matrix[prevRowIdx]?.[prevColIdx] === 'number'
      ) {
        weight = matrix[prevRowIdx]![prevColIdx]!;
      }
      result[row][col] = clampTrustWeight(weight);
    }
    const hasPositiveWeight = result[row].some((value) => value > 0);
    if (!hasPositiveWeight) {
      result[row][row] = 1;
    }
  }
  return result;
};

const createDefaultRunConfig = (agentCount: number): RunConfig => ({
  mode: 'round_robin',
  maxRounds: 4,
  useGlobalModelConfig: true,
  globalModelConfig: { ...defaultModelConfig },
  sentiment: {
    enabled: false,
    mode: 'byCount',
    count: 3,
  },
  trustMatrix: createIdentityMatrix(agentCount),
  visualization: {
    enableStanceChart: false,
  },
});

const createEmptyRunState = (): RunState => {
  const agents = createDefaultAgents();
  return {
    agents,
    config: createDefaultRunConfig(agents.length),
    messages: [],
    visibleWindow: [],
    status: createInitialStatus(),
    stopRequested: false,
  };
};

const createInitialStatus = (mode: DialogueMode = 'round_robin'): RunStatus => ({
  phase: 'idle',
  mode,
  currentRound: 0,
  currentTurn: 0,
  totalMessages: 0,
  summarizedCount: 0,
  awaitingLabel: undefined,
});

export type VendorDefaults = Record<
  Vendor,
  { baseUrl?: string; model?: string; apiKey?: string }
>;

const createVendorDefaults = (): VendorDefaults => ({
  openai: {
    baseUrl: '',
    model: 'gpt-4o',
    apiKey: '',
  },
  anthropic: {
    baseUrl: '',
    model: 'claude-3-5-sonnet-latest',
    apiKey: '',
  },
  gemini: {
    baseUrl: '',
    model: 'gemini-1.5-pro',
    apiKey: '',
  },
});

export interface AppStore {
  runState: RunState;
  currentResult?: SessionResult;
  currentPage: 'configuration' | 'dialogue' | 'results';
  vendorDefaults: VendorDefaults;
  setCurrentPage: (page: 'configuration' | 'dialogue' | 'results') => void;
  updateRunConfig: (updater: Partial<RunConfig> | ((config: RunConfig) => RunConfig)) => void;
  setAgents: (agents: AgentSpec[]) => void;
  addAgent: (agent?: Partial<AgentSpec>) => void;
  updateAgent: (agentId: string, updater: Partial<AgentSpec>) => void;
  removeAgent: (agentId: string) => void;
  resetRunState: () => void;
  appendMessage: (message: Message) => void;
  updateMessage: (messageId: string, updater: (message: Message) => void) => void;
  resetMessages: () => void;
  setVisibleWindow: (messages: Message[]) => void;
  setResult: (result?: SessionResult) => void;
  setVendorBaseUrl: (vendor: Vendor, baseUrl: string) => void;
  setVendorModel: (vendor: Vendor, model: string) => void;
  setVendorApiKey: (vendor: Vendor, apiKey: string) => void;
  setRunMode: (mode: RunConfig['mode']) => void;
  setMaxRounds: (value?: number) => void;
  setMaxMessages: (value?: number) => void;
  setUseGlobalModelConfig: (value: boolean) => void;
  updateGlobalModelConfig: (
    updater: Partial<ModelConfig> | ((current?: ModelConfig) => ModelConfig | undefined),
  ) => void;
  updateSentiment: (updater: Partial<SentimentSetting>) => void;
  setSentimentModelConfig: (
    updater: Partial<ModelConfig> | null | ((current?: ModelConfig) => ModelConfig | undefined),
  ) => void;
    setTrustValue: (rowIndex: number, colIndex: number, weight: number) => void;
    normalizeTrustRow: (rowIndex: number) => void;
    resetTrustMatrix: (mode: 'identity' | 'uniform') => void;
  setRunStatus: (updater: Partial<RunStatus> | ((status: RunStatus) => RunStatus)) => void;
  setStopRequested: (value: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  runState: createEmptyRunState(),
  currentResult: undefined,
  currentPage: 'configuration',
  vendorDefaults: createVendorDefaults(),
  setCurrentPage: (page) => set({ currentPage: page }),
  updateRunConfig: (updater) =>
    set(
      produce((state: AppStore) => {
        const config = state.runState.config;
        state.runState.config =
          typeof updater === 'function' ? updater(config) : { ...config, ...updater };
        state.runState.status.mode = state.runState.config.mode;
      }),
    ),
    setAgents: (agents) =>
      set(
        produce((state: AppStore) => {
          const prevAgents = state.runState.agents.slice();
          state.runState.agents = agents;
          state.runState.config.trustMatrix = rebuildTrustMatrix(
            state.runState.config.trustMatrix,
            prevAgents,
            state.runState.agents,
          );
        }),
      ),
    addAgent: (agent) =>
      set(
        produce((state: AppStore) => {
          const prevAgents = state.runState.agents.slice();
          const nextIndex = state.runState.agents.length + 1;
          state.runState.agents.push({
            id: nanoid(),
            name: `A${nextIndex}`,
            persona: { ...defaultPersona },
            initialOpinion: '',
            ...agent,
          });
          state.runState.config.trustMatrix = rebuildTrustMatrix(
            state.runState.config.trustMatrix,
            prevAgents,
            state.runState.agents,
          );
        }),
      ),
  updateAgent: (agentId, updater) =>
    set(
      produce((state: AppStore) => {
        const agent = state.runState.agents.find((a) => a.id === agentId);
        if (agent) {
          Object.assign(agent, updater);
        }
      }),
    ),
    removeAgent: (agentId) =>
      set(
        produce((state: AppStore) => {
          const prevAgents = state.runState.agents.slice();
          state.runState.agents = state.runState.agents.filter((a) => a.id !== agentId);
          if (state.runState.agents.length === 0) {
            state.runState.agents.push({
              id: nanoid(),
              name: 'A1',
              persona: { ...defaultPersona },
              initialOpinion: '',
            });
          }
          state.runState.config.trustMatrix = rebuildTrustMatrix(
            state.runState.config.trustMatrix,
            prevAgents,
            state.runState.agents,
          );
        }),
      ),
  resetRunState: () =>
    set(
      produce((state: AppStore) => {
        state.runState = createEmptyRunState();
        state.currentResult = undefined;
        state.currentPage = 'configuration';
      }),
    ),
    appendMessage: (message) =>
      set(
        produce((state: AppStore) => {
          state.runState.messages.push(message);
        }),
      ),
  updateMessage: (messageId, updater) =>
    set(
      produce((state: AppStore) => {
        const message = state.runState.messages.find((m) => m.id === messageId);
        if (message) {
          updater(message);
        }
        const windowMessage = state.runState.visibleWindow.find((m) => m.id === messageId);
        if (windowMessage && windowMessage !== message) {
          updater(windowMessage);
        }
      }),
    ),
  resetMessages: () =>
    set(
      produce((state: AppStore) => {
        state.runState.messages = [];
        state.runState.visibleWindow = [];
        state.runState.status = createInitialStatus(state.runState.config.mode);
        state.runState.stopRequested = false;
      }),
    ),
  setVisibleWindow: (messages) =>
    set(
      produce((state: AppStore) => {
        state.runState.visibleWindow = messages;
      }),
    ),
    setResult: (result) => set({ currentResult: result }),
    setVendorBaseUrl: (vendor, baseUrl) =>
      set(
        produce((state: AppStore) => {
          state.vendorDefaults[vendor].baseUrl = baseUrl;
          const global = state.runState.config.globalModelConfig;
          if (global && global.vendor === vendor) {
            global.baseUrl = baseUrl;
          }
        }),
      ),
    setVendorModel: (vendor, model) =>
      set(
        produce((state: AppStore) => {
          state.vendorDefaults[vendor].model = model;
          const global = state.runState.config.globalModelConfig;
          if (global && global.vendor === vendor) {
            global.model = model;
          }
        }),
      ),
    setVendorApiKey: (vendor, apiKey) =>
      set(
        produce((state: AppStore) => {
          state.vendorDefaults[vendor].apiKey = apiKey;
          const global = state.runState.config.globalModelConfig;
          if (global && global.vendor === vendor) {
            global.apiKey = apiKey;
          }
        }),
      ),
  setRunMode: (mode) =>
    set(
      produce((state: AppStore) => {
        state.runState.config.mode = mode;
        state.runState.status.mode = mode;
        if (mode === 'round_robin' && !state.runState.config.maxRounds) {
          state.runState.config.maxRounds = 4;
        }
        if (mode === 'free' && !state.runState.config.maxMessages) {
          state.runState.config.maxMessages = 12;
        }
      }),
    ),
  setMaxRounds: (value) =>
    set(
      produce((state: AppStore) => {
        state.runState.config.maxRounds = value;
      }),
    ),
  setMaxMessages: (value) =>
    set(
      produce((state: AppStore) => {
        state.runState.config.maxMessages = value;
      }),
    ),
  setUseGlobalModelConfig: (value) =>
    set(
      produce((state: AppStore) => {
        state.runState.config.useGlobalModelConfig = value;
        if (value && !state.runState.config.globalModelConfig) {
          state.runState.config.globalModelConfig = { ...defaultModelConfig };
        }
        if (!value) {
          state.runState.config.globalModelConfig = undefined;
        }
      }),
    ),
  updateGlobalModelConfig: (updater) =>
    set(
      produce((state: AppStore) => {
        const current = state.runState.config.globalModelConfig;
        if (typeof updater === 'function') {
          state.runState.config.globalModelConfig = updater(current);
        } else {
          state.runState.config.globalModelConfig = { ...(current ?? { ...defaultModelConfig }), ...updater };
        }
      }),
    ),
  updateSentiment: (updater) =>
    set(
      produce((state: AppStore) => {
        state.runState.config.sentiment = {
          ...state.runState.config.sentiment,
          ...updater,
        };
      }),
    ),
    setSentimentModelConfig: (updater) =>
      set(
        produce((state: AppStore) => {
          const current = state.runState.config.sentiment.modelConfigOverride;
          if (updater === null) {
            state.runState.config.sentiment.modelConfigOverride = undefined;
          } else if (typeof updater === 'function') {
            state.runState.config.sentiment.modelConfigOverride = updater(current ?? undefined);
          } else {
            state.runState.config.sentiment.modelConfigOverride = {
              ...(current ?? { ...defaultModelConfig }),
              ...updater,
            };
          }
        }),
      ),
    setTrustValue: (rowIndex, colIndex, weight) =>
      set(
        produce((state: AppStore) => {
          const size = state.runState.agents.length;
          if (rowIndex < 0 || colIndex < 0 || rowIndex >= size || colIndex >= size) {
            return;
          }
          state.runState.config.trustMatrix[rowIndex][colIndex] = clampTrustWeight(weight);
        }),
      ),
    normalizeTrustRow: (rowIndex) =>
      set(
        produce((state: AppStore) => {
          const row = state.runState.config.trustMatrix[rowIndex];
          if (!row) {
            return;
          }
          const sum = row.reduce((acc, value) => acc + value, 0);
          if (sum === 0) {
            row[rowIndex] = 1;
            return;
          }
          for (let idx = 0; idx < row.length; idx += 1) {
            row[idx] = row[idx] / sum;
          }
        }),
      ),
    resetTrustMatrix: (mode) =>
      set(
        produce((state: AppStore) => {
          const size = state.runState.agents.length;
          if (mode === 'uniform') {
            state.runState.config.trustMatrix = createUniformMatrix(size);
          } else {
            state.runState.config.trustMatrix = createIdentityMatrix(size);
          }
        }),
      ),
  setRunStatus: (updater) =>
    set(
      produce((state: AppStore) => {
        const current = state.runState.status;
        state.runState.status =
          typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      }),
    ),
  setStopRequested: (value) =>
    set(
      produce((state: AppStore) => {
        state.runState.stopRequested = value;
      }),
    ),
}));
