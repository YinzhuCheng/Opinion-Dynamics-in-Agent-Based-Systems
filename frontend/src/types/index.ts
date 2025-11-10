export type Vendor = 'openai' | 'anthropic' | 'gemini';

export interface ModelConfig {
  vendor: Vendor;
  baseUrl?: string;
  apiKeyRef: 'memory' | 'localEncrypted';
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
  globalModelConfig?: ModelConfig;
  sentiment: SentimentSetting;
  memory: {
    summarizationEnabled: true;
    windowTokenBudgetPct: number;
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
}

export interface SessionResult {
  messages: Message[];
  finishedAt: number;
  summary: string;
  configSnapshot: RunConfig;
}

export type PageKey = 'configuration' | 'dialogue' | 'results';
