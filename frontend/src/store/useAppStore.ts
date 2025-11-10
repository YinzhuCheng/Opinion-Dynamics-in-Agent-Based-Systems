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
} from '../types';

const defaultModelConfig: ModelConfig = {
  vendor: 'openai',
  apiKeyRef: 'memory',
  model: 'gpt-4.1-mini',
  temperature: 0.7,
  top_p: 0.95,
  max_output_tokens: 2048,
};

const defaultPersona: Persona = {
  type: 'free',
  description: 'A neutral analyst focused on balanced arguments.',
};

const createDefaultAgents = (): AgentSpec[] => [
  {
    id: nanoid(),
    name: 'A1',
    persona: defaultPersona,
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
  globalModelConfig: { ...defaultModelConfig },
  sentiment: {
    enabled: false,
    mode: 'byCount',
    count: 3,
  },
  memory: {
    summarizationEnabled: true,
    windowTokenBudgetPct: 40,
  },
});

const createEmptyRunState = (): RunState => ({
  agents: createDefaultAgents(),
  config: createDefaultRunConfig(),
  messages: [],
  summary: '',
  visibleWindow: [],
});

export interface AppStore {
  runState: RunState;
  currentResult?: SessionResult;
  currentPage: 'configuration' | 'dialogue' | 'results';
  setCurrentPage: (page: 'configuration' | 'dialogue' | 'results') => void;
  updateRunConfig: (updater: Partial<RunConfig> | ((config: RunConfig) => RunConfig)) => void;
  setAgents: (agents: AgentSpec[]) => void;
  addAgent: (agent?: Partial<AgentSpec>) => void;
  updateAgent: (agentId: string, updater: Partial<AgentSpec>) => void;
  removeAgent: (agentId: string) => void;
  resetRunState: () => void;
  appendMessage: (message: Message) => void;
  resetMessages: () => void;
  setSummary: (summary: string) => void;
  setVisibleWindow: (messages: Message[]) => void;
  setResult: (result?: SessionResult) => void;
}

export const useAppStore = create<AppStore>((set) => ({
  runState: createEmptyRunState(),
  currentResult: undefined,
  currentPage: 'configuration',
  setCurrentPage: (page) => set({ currentPage: page }),
  updateRunConfig: (updater) =>
    set(
      produce((state: AppStore) => {
        const config = state.runState.config;
        state.runState.config =
          typeof updater === 'function' ? updater(config) : { ...config, ...updater };
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
          persona: defaultPersona,
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
            persona: defaultPersona,
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
  resetMessages: () =>
    set(
      produce((state: AppStore) => {
        state.runState.messages = [];
        state.runState.visibleWindow = [];
        state.runState.summary = '';
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
}));
