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
  model: 'gpt-4.1-mini',
  temperature: 0.7,
  top_p: 0.95,
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

const createDefaultRunConfig = (): RunConfig => ({
  mode: 'round_robin',
  maxRounds: 4,
  useGlobalModelConfig: true,
  globalModelConfig: { ...defaultModelConfig },
  sentiment: {
    enabled: false,
    mode: 'byCount',
    count: 3,
  },
  memory: {
    summarizationEnabled: true,
    minWindowPct: 20,
    maxWindowPct: 60,
    growthRate: 1.2,
  },
  visualization: {
    enableStanceChart: false,
  },
});

const createEmptyRunState = (): RunState => ({
  agents: createDefaultAgents(),
  config: createDefaultRunConfig(),
  messages: [],
  summary: '',
  visibleWindow: [],
  status: createInitialStatus(),
  stopRequested: false,
});

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
    model: 'gpt-4.1-mini',
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
  updateSentiment: (updater: Partial<SentimentSetting>) => void;
  setSentimentModelConfig: (
    updater: Partial<ModelConfig> | null | ((current?: ModelConfig) => ModelConfig | undefined),
  ) => void;
  updateMemoryConfig: (updater: Partial<RunConfig['memory']>) => void;
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
      }),
    ),
    addAgent: (agent) =>
      set(
        produce((state: AppStore) => {
          const nextIndex = state.runState.agents.length + 1;
          state.runState.agents.push({
            id: nanoid(),
            name: `A${nextIndex}`,
            persona: { ...defaultPersona },
            initialOpinion: '',
            ...agent,
          });
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
            state.runState.agents.push({
              id: nanoid(),
              name: 'A1',
              persona: { ...defaultPersona },
              initialOpinion: '',
            });
        }
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
    updateMemoryConfig: (updater) =>
      set(
        produce((state: AppStore) => {
          const current = state.runState.config.memory;
          const next = { ...current, ...updater };
          const clampPct = (val: number | undefined, fallback: number) => {
            const numeric = typeof val === 'number' && !Number.isNaN(val) ? val : fallback;
            return Math.min(90, Math.max(5, numeric));
          };
          next.minWindowPct = clampPct(next.minWindowPct, current.minWindowPct);
          next.maxWindowPct = clampPct(next.maxWindowPct, current.maxWindowPct);
          if (next.minWindowPct > next.maxWindowPct) {
            [next.minWindowPct, next.maxWindowPct] = [next.maxWindowPct, next.minWindowPct];
          }
          const growth = typeof next.growthRate === 'number' && !Number.isNaN(next.growthRate)
            ? next.growthRate
            : current.growthRate;
          next.growthRate = Math.min(5, Math.max(0.2, growth));
          if (typeof next.summarizationEnabled !== 'boolean') {
            next.summarizationEnabled = current.summarizationEnabled;
          }
          state.runState.config.memory = next;
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
