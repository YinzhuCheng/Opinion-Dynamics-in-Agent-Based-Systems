export type Vendor = 'openai' | 'anthropic' | 'gemini';

export interface ModelConfig {
  vendor: Vendor;
  baseUrl?: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  systemPromptExtra?: string;
}

export type PersonaType = 'big5' | 'mbti' | 'free';

export interface PersonaBig5 {
  type: 'big5';
  O: number;
  C: number;
  E: number;
  A: number;
  N: number;
  templateKey?: string;
  notes?: string;
}

export type MBTICode =
  | 'INTJ'
  | 'INTP'
  | 'ENTJ'
  | 'ENTP'
  | 'INFJ'
  | 'INFP'
  | 'ENFJ'
  | 'ENFP'
  | 'ISTJ'
  | 'ISFJ'
  | 'ESTJ'
  | 'ESFJ'
  | 'ISTP'
  | 'ISFP'
  | 'ESTP'
  | 'ESFP';

export interface PersonaMBTI {
  type: 'mbti';
  mbti: MBTICode;
  templateKey?: string;
  notes?: string;
}

export interface PersonaFree {
  type: 'free';
  description: string;
}

export type Persona = PersonaBig5 | PersonaMBTI | PersonaFree;

export interface AgentSpec {
  id: string;
  name: string;
  persona: Persona;
  initialOpinion?: string;
  modelConfig?: ModelConfig;
}

export interface SentimentSetting {
  enabled: boolean;
  mode: 'byCount' | 'byList';
  count?: number;
  labels?: string[];
  modelConfigOverride?: ModelConfig;
}

export type DialogueMode = 'round_robin' | 'free';

export interface RunConfig {
  mode: DialogueMode;
  maxRounds?: number;
  maxMessages?: number;
  useGlobalModelConfig: boolean;
  globalModelConfig?: ModelConfig;
  sentiment: SentimentSetting;
  memory: {
    summarizationEnabled: true;
    windowTokenBudgetPct: number;
  };
  visualization: {
    enableStanceChart: boolean;
  };
}

export interface Message {
  id: string;
  agentId: string;
  role: 'assistant';
  content: string;
  ts: number;
  sentiment?: { label: string; confidence?: number };
  stance?: { score: number; note?: string };
}

export interface RunState {
  agents: AgentSpec[];
  config: RunConfig;
  messages: Message[];
  summary: string;
  visibleWindow: Message[];
  status: RunStatus;
  stopRequested: boolean;
}

export interface SessionResult {
  messages: Message[];
  finishedAt: number;
  summary: string;
  configSnapshot: RunConfig;
  status: RunStatus;
}

export interface RunStatus {
  phase: 'idle' | 'running' | 'stopping' | 'completed' | 'error' | 'cancelled';
  mode: DialogueMode;
  startedAt?: number;
  finishedAt?: number;
  currentRound: number;
  currentTurn: number;
  totalMessages: number;
  summarizedCount: number;
  lastAgentId?: string;
  error?: string;
  awaitingLabel?: 'response' | 'thinking';
}

export type PageKey = 'configuration' | 'dialogue' | 'results';
