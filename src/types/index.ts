export type Vendor = 'openai' | 'anthropic' | 'gemini';

export type Big5TraitKey = 'O' | 'C' | 'E' | 'A' | 'N';

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
  initialStance?: number;
  modelConfig?: ModelConfig;
}

export type DialogueMode = 'random' | 'sequential';

export interface PromptToggleConfig {
  persona: boolean;
  trustMatrix: boolean;
  randomLength: boolean;
  memory: boolean;
}

export type PromptToggleKey = keyof PromptToggleConfig;

export const DEFAULT_PROMPT_TOGGLES: PromptToggleConfig = {
  persona: true,
  trustMatrix: true,
  randomLength: true,
  memory: true,
};

export interface RunConfig {
  mode: DialogueMode;
  maxRounds?: number;
  maxMessages?: number;
  useGlobalModelConfig: boolean;
  globalModelConfig?: ModelConfig;
  trustMatrix: TrustMatrix;
  discussion: {
    stanceScaleSize: number;
    positiveViewpoint: string;
    negativeViewpoint: string;
  };
  visualization: {
    enableStanceChart: boolean;
  };
    promptToggles: PromptToggleConfig;
  personaTraversalExperiment?: PersonaTraversalExperimentConfig;
}

export type TrustMatrix = Record<string, Record<string, number>>;

export interface PersonaTraversalExperimentConfig {
  enabled: boolean;
  /**
   * Only supported when exactly 2 agents.
   * The experiment always traverses BOTH agents' Big5 values.
   */
  agentIds: [string, string];
  /** Selected dimensions to traverse. M = dimensions.length * (levels.length ^ 2). */
  dimensions: Big5TraitKey[];
  /** Default: [10,30,50,70,90] */
  levels: number[];
  /** Concurrency pool size, 1..M */
  concurrency: number;
}

export interface ExperimentTrackMeta {
  index: number;
  trait: Big5TraitKey;
  agentAId: string;
  agentBId: string;
  agentAValue: number;
  agentBValue: number;
}

export interface ExperimentTrackResult {
  id: string;
  meta: ExperimentTrackMeta;
  result: SessionResult;
}

export interface PersonaTraversalExperimentResult {
  config: PersonaTraversalExperimentConfig;
  totalTracks: number;
  startedAt: number;
  finishedAt: number;
  tracks: ExperimentTrackResult[];
}

export type ExperimentPhase = 'idle' | 'running' | 'completed' | 'cancelled' | 'error';

export interface PersonaTraversalExperimentStatus {
  phase: ExperimentPhase;
  totalTracks: number;
  completedTracks: number;
  runningTracks: number;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

export interface PersonaTraversalExperimentRecord {
  id: string;
  name: string;
  createdAt: number;
  agentsSnapshot: AgentSpec[];
  runConfigSnapshot: RunConfig;
  status: PersonaTraversalExperimentStatus;
  result?: PersonaTraversalExperimentResult;
}

export interface Message {
  id: string;
  agentId: string;
  agentName?: string;
  role: 'assistant';
  content: string;
  rawContent?: string;
  ts: number;
  round: number;
  turn: number;
  systemPrompt?: string;
  userPrompt?: string;
  stance?: { score: number; note?: string };
  thoughtSummary?: string;
  innerState?: string;
  personalMemory?: string[];
  othersMemory?: string[];
}

export type FailureCategory =
  | 'response_empty'
  | 'extraction_missing'
  | 'format_correction_failed'
  | 'request_error'
  | 'unknown';

export interface FailureRecord {
  id: string;
  agentId: string;
  agentName?: string;
  round: number;
  turn: number;
  category: FailureCategory;
  reason: string;
  timestamp: number;
  systemPrompt?: string;
  userPrompt?: string;
  rawOutput?: string;
  errorMessage?: string;
}

export interface RunState {
  agents: AgentSpec[];
  config: RunConfig;
  messages: Message[];
  failureRecords: FailureRecord[];
  summary: string;
  visibleWindow: Message[];
  status: RunStatus;
  stopRequested: boolean;
  lastRandomMatrix?: TrustMatrix;
}

export interface SessionResult {
  messages: Message[];
  finishedAt: number;
  summary: string;
  configSnapshot: RunConfig;
  status: RunStatus;
  failures: FailureRecord[];
}

export interface RunStatus {
  phase: 'idle' | 'running' | 'stopping' | 'completed' | 'error' | 'cancelled' | 'paused';
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
  sessionId: number;
}

export type PageKey = 'configuration' | 'dialogue' | 'results';
