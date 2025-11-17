import { produce } from 'immer';
import { nanoid } from 'nanoid';
import { create } from 'zustand';
import type {
  AgentSpec,
  Message,
  ModelConfig,
  PersonaFree,
  RunConfig,
  RunState,
    SessionResult,
  Vendor,
  DialogueMode,
  RunStatus,
  TrustMatrix,
} from '../types';
import {
  DEFAULT_NEGATIVE_VIEWPOINT,
  DEFAULT_POSITIVE_VIEWPOINT,
} from '../constants/discussion';

const defaultModelConfig: ModelConfig = {
  vendor: 'openai',
  baseUrl: '',
  apiKey: '',
  model: 'gpt-4o',
};

const createFreePersona = (): PersonaFree => ({
  type: 'free',
  description: '',
});

const buildAgent = (index: number, overrides?: Partial<AgentSpec>): AgentSpec => ({
  id: nanoid(),
  name: `A${index + 1}`,
  persona: overrides?.persona ?? createFreePersona(),
  initialOpinion: overrides?.initialOpinion ?? '',
  initialStance: overrides?.initialStance,
  modelConfig: overrides?.modelConfig,
});

const createDefaultAgents = (): AgentSpec[] => [
  buildAgent(0),
  buildAgent(1),
];

const clampTrustValue = (value: number): number => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
};

const defaultTrustFallback = (rowId: string, colId: string, agentCount: number): number => {
  if (agentCount <= 1) {
    return 1;
  }
  if (rowId === colId) {
    return 0.6;
  }
  const remainder = 0.4;
  const others = Math.max(1, agentCount - 1);
  return Number((remainder / others).toFixed(2));
};

const ensureTrustMatrix = (agents: AgentSpec[], matrix?: TrustMatrix): TrustMatrix => {
  const agentIds = agents.map((agent) => agent.id);
  const next: TrustMatrix = {};
  agentIds.forEach((rowId) => {
    const existingRow = matrix?.[rowId] ?? {};
    const row: Record<string, number> = {};
    agentIds.forEach((colId) => {
      const existingValue = existingRow[colId];
      if (typeof existingValue === 'number' && Number.isFinite(existingValue)) {
        row[colId] = clampTrustValue(existingValue);
      } else {
        row[colId] = defaultTrustFallback(rowId, colId, agentIds.length);
      }
    });
    const hasPositive = Object.values(row).some((value) => value > 0);
    if (!hasPositive && agentIds.length > 0) {
      const uniform = 1 / agentIds.length;
      agentIds.forEach((colId) => {
        row[colId] = Number(uniform.toFixed(2));
      });
    }
    next[rowId] = row;
  });
  return next;
};

const normalizeTrustRowValues = (row: Record<string, number>): Record<string, number> => {
  const entries = Object.entries(row).map(([key, value]) => [key, clampTrustValue(value)] as [string, number]);
  if (entries.length === 0) return row;
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) {
    const uniform = 1 / entries.length;
    return entries.reduce<Record<string, number>>((acc, [key], index) => {
      const value =
        index === entries.length - 1 ? Number((1 - uniform * (entries.length - 1)).toFixed(2)) : Number(uniform.toFixed(2));
      acc[key] = value;
      return acc;
    }, {});
  }
  return entries.reduce<Record<string, number>>((acc, [key, value]) => {
    acc[key] = Number((value / total).toFixed(3));
    return acc;
  }, {});
};

const sanitizeStanceScaleSize = (value: number | undefined): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 3;
  const atLeastThree = Math.max(3, numeric);
  return atLeastThree % 2 === 0 ? atLeastThree + 1 : atLeastThree;
};

const createDefaultRunConfig = (): RunConfig => ({
  mode: 'round_robin',
  maxRounds: 4,
  useGlobalModelConfig: true,
  globalModelConfig: { ...defaultModelConfig },
  visualization: {
    enableStanceChart: true,
  },
  trustMatrix: {},
  trustRandomAlpha: 0.8,
  discussion: {
    stanceScaleSize: 3,
    positiveViewpoint: DEFAULT_POSITIVE_VIEWPOINT,
    negativeViewpoint: DEFAULT_NEGATIVE_VIEWPOINT,
  },
});

const createEmptyRunState = (): RunState => {
  const agents = createDefaultAgents();
  const config = createDefaultRunConfig();
  config.trustMatrix = ensureTrustMatrix(agents, config.trustMatrix);
  return {
    agents,
    config,
    messages: [],
    summary: '',
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
  setSummary: (summary: string) => void;
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
  setTrustValue: (sourceId: string, targetId: string, value: number) => void;
  normalizeTrustRow: (sourceId: string) => void;
  setStanceScaleSize: (size: number) => void;
  setPositiveViewpoint: (text: string) => void;
  setNegativeViewpoint: (text: string) => void;
  randomizeTrustMatrix: () => void;
  uniformTrustMatrix: () => void;
  setTrustRandomAlpha: (value: number) => void;
  configureAgentGroup: (count: number, stanceTemplate: number[]) => void;
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
          state.runState.agents = agents;
          state.runState.config.trustMatrix = ensureTrustMatrix(
            state.runState.agents,
            state.runState.config.trustMatrix,
          );
        }),
      ),
      addAgent: (agent) =>
        set(
          produce((state: AppStore) => {
            const nextIndex = state.runState.agents.length;
            state.runState.agents.push(buildAgent(nextIndex, agent));
            state.runState.config.trustMatrix = ensureTrustMatrix(
              state.runState.agents,
              state.runState.config.trustMatrix,
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
          state.runState.agents = state.runState.agents.filter((a) => a.id !== agentId);
            if (state.runState.agents.length === 0) {
              state.runState.agents.push(buildAgent(0));
            }
          state.runState.config.trustMatrix = ensureTrustMatrix(
            state.runState.agents,
            state.runState.config.trustMatrix,
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
        state.runState.visibleWindow.push(message);
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
        state.runState.summary = '';
        state.runState.status = createInitialStatus(state.runState.config.mode);
        state.runState.stopRequested = false;
      }),
    ),
  setSummary: (summary) =>
    set(
      produce((state: AppStore) => {
        state.runState.summary = summary;
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
    setTrustValue: (sourceId, targetId, value) =>
      set(
        produce((state: AppStore) => {
          state.runState.config.trustMatrix = ensureTrustMatrix(
            state.runState.agents,
            state.runState.config.trustMatrix,
          );
          if (!state.runState.config.trustMatrix[sourceId]) {
            state.runState.config.trustMatrix[sourceId] = {};
          }
          state.runState.config.trustMatrix[sourceId][targetId] = clampTrustValue(value);
        }),
      ),
    normalizeTrustRow: (sourceId) =>
      set(
        produce((state: AppStore) => {
          const row = state.runState.config.trustMatrix[sourceId];
          if (!row) {
            return;
          }
          state.runState.config.trustMatrix[sourceId] = normalizeTrustRowValues(row);
        }),
      ),
      setStanceScaleSize: (size) =>
        set(
          produce((state: AppStore) => {
            state.runState.config.discussion.stanceScaleSize = sanitizeStanceScaleSize(size);
          }),
        ),
    setPositiveViewpoint: (text) =>
      set(
        produce((state: AppStore) => {
          state.runState.config.discussion.positiveViewpoint = text;
        }),
      ),
    setNegativeViewpoint: (text) =>
      set(
        produce((state: AppStore) => {
          state.runState.config.discussion.negativeViewpoint = text;
        }),
      ),
      randomizeTrustMatrix: () =>
        set(
          produce((state: AppStore) => {
            const agentIds = state.runState.agents.map((agent) => agent.id);
            const nextMatrix: TrustMatrix = {};
          const alphaRaw = state.runState.config.trustRandomAlpha;
          const alpha = Math.min(1, Math.max(0, Number.isFinite(alphaRaw) ? alphaRaw : 0.8));
            agentIds.forEach((sourceId) => {
              const rawRow: Record<string, number> = {};
              agentIds.forEach((targetId) => {
                  rawRow[targetId] = Math.random() + 0.01;
              });
                const normalizedRow = normalizeTrustRowValues(rawRow);
                const finalRow: Record<string, number> = {};
                agentIds.forEach((targetId) => {
                  const identity = sourceId === targetId ? 1 : 0;
                  const randomWeight = normalizedRow[targetId] ?? 0;
                  finalRow[targetId] =
                    (1 - alpha) * randomWeight + alpha * identity;
                });
                nextMatrix[sourceId] = finalRow;
            });
            state.runState.config.trustMatrix = nextMatrix;
          }),
        ),
      uniformTrustMatrix: () =>
        set(
          produce((state: AppStore) => {
            const agentIds = state.runState.agents.map((agent) => agent.id);
            const nextMatrix: TrustMatrix = {};
            agentIds.forEach((sourceId) => {
              const row: Record<string, number> = {};
              agentIds.forEach((targetId) => {
                row[targetId] = 1;
              });
              nextMatrix[sourceId] = normalizeTrustRowValues(row);
            });
            state.runState.config.trustMatrix = nextMatrix;
          }),
        ),
    setTrustRandomAlpha: (value) =>
      set(
        produce((state: AppStore) => {
          const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.8));
          state.runState.config.trustRandomAlpha = Number(clamped.toFixed(2));
        }),
      ),
    configureAgentGroup: (count, stanceTemplate) =>
      set(
          produce((state: AppStore) => {
            const normalizedSize = sanitizeStanceScaleSize(state.runState.config.discussion.stanceScaleSize);
            const maxLevel = Math.floor(Math.max(3, normalizedSize) / 2);
          const sanitizedTemplate = stanceTemplate
            .filter((value) => typeof value === 'number' && Number.isFinite(value))
            .map((value) => Math.max(-maxLevel, Math.min(maxLevel, Math.round(value))));
          const effectiveTemplate = sanitizedTemplate.length > 0 ? sanitizedTemplate : [0];
          const safeCount = Math.max(1, Math.min(50, Math.floor(count)));
          const agents: AgentSpec[] = [];
          for (let i = 0; i < safeCount; i += 1) {
            const stance = effectiveTemplate[i % effectiveTemplate.length];
            agents.push(
              buildAgent(i, {
                initialStance: stance,
              }),
            );
          }
          state.runState.agents = agents;
          state.runState.config.trustMatrix = ensureTrustMatrix(
            state.runState.agents,
            state.runState.config.trustMatrix,
          );
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
