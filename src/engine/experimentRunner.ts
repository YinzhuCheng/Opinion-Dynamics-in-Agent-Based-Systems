import { nanoid } from 'nanoid';
import type {
  AgentSpec,
  FailureRecord,
  Message,
  ModelConfig,
  PromptToggleConfig,
  RunConfig,
  RunStatus,
  SessionResult,
  Big5TraitKey,
  PersonaTraversalExperimentConfig,
  PersonaTraversalExperimentResult,
  ExperimentTrackResult,
  PersonaBig5,
  PersonaTraversalExperimentRecord,
  PersonaTraversalExperimentStatus,
} from '../types';
import { DEFAULT_PROMPT_TOGGLES } from '../types';
import { useAppStore } from '../store/useAppStore';
import { chatStream } from '../utils/llmAdapter';
import type { ChatMessage } from '../utils/llmAdapter';
import {
  ensureNegativeViewpoint,
  ensurePositiveViewpoint,
} from '../constants/discussion';
import {
  buildAgentSystemPrompt,
  buildAgentUserPrompt,
  AGENT_OUTPUT_JSON_SCHEMA,
  AGENT_OUTPUT_JSON_SCHEMA_NO_STANCE,
} from './prompts';
import type { VendorDefaults } from '../store/useAppStore';

const PRIVATE_MEMORY_WINDOW = 3;
const MAX_AGENT_OUTPUT_ATTEMPTS = 3;

type ParsedAgentJsonData = {
  content: string;
  thoughtSummary: string;
  innerState: string;
  stance: { score: number; note?: string };
  normalizedRaw?: string;
  personalMemory: string[];
  othersMemory: string[];
};

type ParseAgentJsonResult = {
  success: boolean;
  data?: ParsedAgentJsonData;
  reason?: string;
  category?: FailureRecord['category'];
};

type ExperimentControl = {
  stopped: boolean;
  inflightControllers: Set<AbortController>;
  experimentId?: string;
};

let activeExperiment: ExperimentControl | undefined;

export const stopPersonaTraversalExperiment = () => {
  if (!activeExperiment) return;
  const expId = activeExperiment.experimentId;
  activeExperiment.stopped = true;
  activeExperiment.inflightControllers.forEach((controller) => controller.abort());
  activeExperiment.inflightControllers.clear();
  if (expId) {
    useAppStore.getState().updateExperiment(expId, (record) => ({
      ...record,
      status: {
        ...record.status,
        phase: record.status.phase === 'completed' ? record.status.phase : 'cancelled',
        runningTracks: 0,
        finishedAt: Date.now(),
      },
    }));
  }
};

export const startPersonaTraversalExperiment = async () => {
  const store = useAppStore.getState();
  const { agents, config } = store.runState;
  const exp = config.personaTraversalExperiment;
  if (!exp?.enabled) {
    throw new Error('人格遍历实验未启用。');
  }
  if (agents.length !== 2) {
    throw new Error('人格遍历实验目前仅支持 2 个 Agent。');
  }
  if (!exp.dimensions || exp.dimensions.length === 0) {
    throw new Error('请至少选择 1 个遍历维度（O/C/E/A/N）。');
  }

  stopPersonaTraversalExperiment();
  const control: ExperimentControl = { stopped: false, inflightControllers: new Set() };
  activeExperiment = control;

  const startedAt = Date.now();

  const resolved = normalizeExperimentConfig(exp, agents);
  const tracksPlan = buildExperimentTracks(resolved);
  const totalTracks = tracksPlan.length;
  const concurrency = Math.max(1, Math.min(totalTracks, resolved.concurrency));

  const experimentId = buildExperimentId(startedAt);
  const experimentName = buildExperimentName(resolved);
  control.experimentId = experimentId;
  const initialStatus: PersonaTraversalExperimentStatus = {
    phase: 'running',
    totalTracks,
    completedTracks: 0,
    runningTracks: 0,
    startedAt,
  };
  const record: PersonaTraversalExperimentRecord = {
    id: experimentId,
    name: experimentName,
    createdAt: startedAt,
    agentsSnapshot: agents.map((agent) => ({ ...agent })),
    runConfigSnapshot: { ...config, personaTraversalExperiment: resolved },
    status: initialStatus,
    result: {
      config: resolved,
      totalTracks,
      startedAt,
      finishedAt: startedAt,
      tracks: [],
    },
  };
  store.addExperiment(record);

  const results: ExperimentTrackResult[] = [];
  const baseRunConfig = { ...config, personaTraversalExperiment: resolved };
  const vendorDefaults = store.vendorDefaults;

  let completed = 0;
  let running = 0;

  const updateStatus = (partial: Partial<PersonaTraversalExperimentStatus>) => {
    useAppStore.getState().updateExperiment(experimentId, (current) => ({
      ...current,
      status: {
        ...current.status,
        ...partial,
      },
    }));
  };

  const appendTrack = (track: ExperimentTrackResult) => {
    useAppStore.getState().updateExperiment(experimentId, (current) => {
      const existing = current.result?.tracks ?? [];
      const nextTracks = [...existing, track].sort((a, b) => a.meta.index - b.meta.index);
      const nextResult: PersonaTraversalExperimentResult = {
        config: resolved,
        totalTracks,
        startedAt,
        finishedAt: Date.now(),
        tracks: nextTracks,
      };
      return {
        ...current,
        result: nextResult,
      };
    });
  };

  const runOne = async (plan: { trait: Big5TraitKey; index: number; agentAValue: number; agentBValue: number }) => {
    if (control.stopped) return;
    running += 1;
    updateStatus({ runningTracks: running });
    try {
      const [agentAId, agentBId] = resolved.agentIds;
      const agentsForTrack = applyBig5OverrideForTrack(agents, agentAId, agentBId, plan.trait, plan.agentAValue, plan.agentBValue);
      const session = await runDetachedConversation({
        agents: agentsForTrack,
        config: baseRunConfig,
        vendorDefaults,
        control,
      });
      if (control.stopped) {
        return;
      }
      results.push({
        id: nanoid(),
        meta: {
          index: plan.index,
          trait: plan.trait,
          agentAId,
          agentBId,
          agentAValue: plan.agentAValue,
          agentBValue: plan.agentBValue,
        },
        result: session,
      });
      appendTrack(results[results.length - 1]);
    } finally {
      running -= 1;
      completed += 1;
      updateStatus({ runningTracks: running, completedTracks: completed });
    }
  };

  try {
    await runWithConcurrency(tracksPlan, concurrency, runOne, () => control.stopped);
    const finishedAt = Date.now();
    if (control.stopped) {
      updateStatus({
        phase: 'cancelled',
        completedTracks: completed,
        runningTracks: 0,
        finishedAt,
      });
    } else {
      updateStatus({
        phase: 'completed',
        completedTracks: completed,
        runningTracks: 0,
        finishedAt,
      });
    }

    const finalResult: PersonaTraversalExperimentResult = {
      config: resolved,
      totalTracks,
      startedAt,
      finishedAt,
      tracks: results.sort((a, b) => a.meta.index - b.meta.index),
    };
    useAppStore.getState().updateExperiment(experimentId, (current) => ({
      ...current,
      result: finalResult,
    }));
  } catch (error: any) {
    const finishedAt = Date.now();
    updateStatus({
      phase: 'error',
      completedTracks: completed,
      runningTracks: 0,
      finishedAt,
      error: error?.message ?? '人格遍历实验运行失败。',
    });
    throw error;
  } finally {
    if (activeExperiment === control) {
      activeExperiment = undefined;
    }
  }
};

const buildExperimentId = (startedAt: number): string => {
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
  return `exp-${stamp}`;
};

const buildExperimentName = (exp: PersonaTraversalExperimentConfig): string => {
  const dims = exp.dimensions?.length ? exp.dimensions.join('') : 'none';
  const grid = `${exp.levels.length}x${exp.levels.length}`;
  return `Grid(${dims}) ${grid} k=${exp.concurrency}`;
};

const normalizeExperimentConfig = (
  exp: PersonaTraversalExperimentConfig,
  agents: AgentSpec[],
): PersonaTraversalExperimentConfig => {
  const levels = exp.levels?.length ? exp.levels : [10, 30, 50, 70, 90];
  const uniqueLevels = Array.from(new Set(levels.map((v) => Math.round(v)))).filter((v) => v >= 0 && v <= 100);
  const dims = exp.dimensions?.length ? exp.dimensions : ([] as Big5TraitKey[]);
  const uniqueDims = Array.from(new Set(dims));
  const agentIds: [string, string] =
    exp.agentIds?.length === 2
      ? exp.agentIds
      : ([agents[0]?.id ?? '', agents[1]?.id ?? ''] as [string, string]);
  const M = uniqueDims.length > 0 ? uniqueDims.length * uniqueLevels.length * uniqueLevels.length : 0;
  return {
    ...exp,
    agentIds,
    dimensions: uniqueDims,
    levels: uniqueLevels,
    concurrency: Math.max(1, Math.min(M || 1, Math.floor(exp.concurrency || 1))),
  };
};

const buildExperimentTracks = (
  exp: PersonaTraversalExperimentConfig,
): Array<{ trait: Big5TraitKey; agentAValue: number; agentBValue: number; index: number }> => {
  const plan: Array<{ trait: Big5TraitKey; agentAValue: number; agentBValue: number; index: number }> = [];
  let idx = 0;
  exp.dimensions.forEach((trait) => {
    exp.levels.forEach((agentAValue) => {
      exp.levels.forEach((agentBValue) => {
        plan.push({ trait, agentAValue, agentBValue, index: idx });
        idx += 1;
      });
    });
  });
  return plan;
};

const applyBig5OverrideForTrack = (
  agents: AgentSpec[],
  agentAId: string,
  agentBId: string,
  trait: Big5TraitKey,
  agentAValue: number,
  agentBValue: number,
): AgentSpec[] => {
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const clampedA = clamp(agentAValue);
  const clampedB = clamp(agentBValue);
  return agents.map((agent) => {
    const persona: PersonaBig5 = {
      type: 'big5',
      O: 50,
      C: 50,
      E: 50,
      A: 50,
      N: 50,
    };
    const applyValue = agent.id === agentAId ? clampedA : agent.id === agentBId ? clampedB : undefined;
    if (typeof applyValue !== 'number') {
      return agent;
    }
    if (trait === 'O') persona.O = applyValue;
    if (trait === 'C') persona.C = applyValue;
    if (trait === 'E') persona.E = applyValue;
    if (trait === 'A') persona.A = applyValue;
    if (trait === 'N') persona.N = applyValue;
    return {
      ...agent,
      persona,
    };
  });
};

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  shouldStop: () => boolean,
) => {
  const queue = [...items];
  const running: Promise<void>[] = [];
  const next = async () => {
    if (shouldStop()) return;
    const item = queue.shift();
    if (!item) return;
    await worker(item);
    await next();
  };
  const k = Math.max(1, Math.min(concurrency, items.length || 1));
  for (let i = 0; i < k; i += 1) {
    running.push(next());
  }
  await Promise.all(running);
};

const defaultFallbackModel = (): ModelConfig => ({
  vendor: 'openai',
  baseUrl: '',
  apiKey: '',
  model: 'gpt-4o',
  temperature: 0.7,
  top_p: 0.95,
});

const normalizeScaleSize = (value: number | undefined): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 3;
  const atLeastThree = Math.max(3, numeric);
  return atLeastThree % 2 === 0 ? atLeastThree + 1 : atLeastThree;
};

const shuffleAgentsList = (agents: AgentSpec[]): AgentSpec[] => {
  const order = [...agents];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

const runDetachedConversation = async ({
  agents,
  config,
  vendorDefaults,
  control,
}: {
  agents: AgentSpec[];
  config: RunConfig;
  vendorDefaults: VendorDefaults;
  control: ExperimentControl;
}): Promise<SessionResult> => {
  const maxRounds = config.maxRounds ?? 3;
  const maxMessages = typeof config.maxMessages === 'number' && Number.isFinite(config.maxMessages) ? Math.max(1, Math.floor(config.maxMessages)) : undefined;
  const startedAt = Date.now();

  const status: RunStatus = {
    phase: 'running',
    mode: config.mode,
    currentRound: 0,
    currentTurn: 0,
    totalMessages: 0,
    summarizedCount: 0,
    startedAt,
    finishedAt: undefined,
    error: undefined,
    lastAgentId: undefined,
    awaitingLabel: undefined,
    sessionId: 0,
  };

  const failures: FailureRecord[] = [];
  const messages: Message[] = [];
  const agentNames = agents.reduce<Record<string, string>>((acc, agent) => {
    acc[agent.id] = agent.name;
    return acc;
  }, {});

  for (let round = 1; round <= maxRounds; round += 1) {
    if (control.stopped) break;
    const roundOrder = config.mode === 'sequential' ? agents : shuffleAgentsList(agents);
    for (let idx = 0; idx < roundOrder.length; idx += 1) {
      if (control.stopped) break;
      if (maxMessages && messages.length >= maxMessages) break;
      const agent = roundOrder[idx];
      status.currentRound = round;
      status.currentTurn = idx + 1;
      status.lastAgentId = agent.id;
      const msg = await executeAgentTurnLocal({
        agent,
        agents,
        round,
        turn: idx + 1,
        config,
        messages,
        failures,
        agentNames,
        vendorDefaults,
        control,
      });
      if (msg) {
        messages.push(msg);
        status.totalMessages = messages.length;
      }
    }
  }

  status.finishedAt = Date.now();
  status.phase = control.stopped ? 'cancelled' : 'completed';

  return {
    messages,
    finishedAt: status.finishedAt,
    summary: '',
    configSnapshot: config,
    status,
    failures,
  };
};

const buildTrustContext = (agents: AgentSpec[], config: RunConfig, agentId: string): Array<{ agentName: string; weight: number }> => {
  const trustRow = config.trustMatrix?.[agentId];
  const entries = agents.map((agent) => {
    const raw =
      typeof trustRow?.[agent.id] === 'number'
        ? Number(trustRow[agent.id])
        : agent.id === agentId
          ? 1
          : 0;
    return { agentName: agent.name, weight: Math.max(0, raw) };
  });
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) {
    const uniform = entries.length > 0 ? 1 / entries.length : 0;
    return entries.map((entry) => ({ ...entry, weight: Number(uniform.toFixed(3)) }));
  }
  return entries.map((entry) => ({ ...entry, weight: Number((entry.weight / total).toFixed(3)) }));
};

const collectPreviousThoughtSummaries = (
  round: number,
  agentId: string,
  agentNames: Record<string, string>,
  messages: Message[],
): Array<{ agentName: string; thoughtSummary: string; round: number }> => {
  if (round <= 0) return [];
  const startRound = Math.max(1, round - PRIVATE_MEMORY_WINDOW + 1);
  return messages
    .filter(
      (message) =>
        message.agentId === agentId &&
        message.round >= startRound &&
        message.round <= round &&
        typeof message.thoughtSummary === 'string' &&
        message.thoughtSummary.trim().length > 0,
    )
    .sort((a, b) => a.round - b.round)
    .map((message) => ({
      agentName: agentNames[message.agentId] ?? message.agentId,
      thoughtSummary: (message.thoughtSummary ?? '').trim(),
      round: message.round,
    }));
};

const removeOthersMemorySection = (innerState?: string): string => {
  if (!innerState) return '';
  const sanitized = innerState
    .replace(/【他人发言记忆】[\s\S]*?(?=【[^】]+】|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return sanitized;
};

const collectPreviousInnerStates = (
  round: number,
  agentId: string,
  agentNames: Record<string, string>,
  messages: Message[],
): Array<{ agentName: string; innerState: string; round: number }> => {
  if (round <= 0) return [];
  const startRound = Math.max(1, round - PRIVATE_MEMORY_WINDOW + 1);
  return messages
    .filter(
      (message) =>
        message.agentId === agentId &&
        message.round >= startRound &&
        message.round <= round &&
        typeof message.innerState === 'string' &&
        message.innerState.trim().length > 0,
    )
    .sort((a, b) => a.round - b.round)
    .map((message) => ({
      agentName: agentNames[message.agentId] ?? message.agentId,
      innerState: removeOthersMemorySection(message.innerState),
      round: message.round,
    }))
    .filter((entry) => entry.innerState.length > 0);
};

const stripCodeFences = (text: string): string => {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match) {
    return match[1];
  }
  return text;
};

const normalizeStringArray = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
    return normalized.length > 0 ? normalized : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : undefined;
  }
  return undefined;
};

const formatStateSection = (label: string, values: string[]): string => {
  const lines = values.map((item) => `- ${item}`).join('\n');
  return `【${label}】\n${lines}`;
};

const parseAgentJsonOutput = (
  rawContent: string,
  discussion: RunConfig['discussion'],
  forcedStanceScore?: number,
): ParseAgentJsonResult => {
  const cleaned = stripCodeFences(rawContent).trim();
  if (!cleaned) {
    return { success: false, reason: '输出内容为空', category: 'extraction_missing' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error: any) {
    return {
      success: false,
      reason: `JSON 解析失败：${error?.message ?? error}`,
      category: 'extraction_missing',
    };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { success: false, reason: '输出必须是 JSON 对象', category: 'extraction_missing' };
  }
  const node = parsed as any;

  const state = node.state;
  if (!state || typeof state !== 'object') {
    return { success: false, reason: '缺少 state 字段', category: 'extraction_missing' };
  }
  const stateSections: Array<{
    key: 'personal_memory' | 'others_memory' | 'long_term' | 'short_term';
    label: string;
  }> = [
    { key: 'personal_memory', label: '个人发言记忆' },
    { key: 'others_memory', label: '他人发言记忆' },
    { key: 'long_term', label: '长期状态' },
    { key: 'short_term', label: '短期波动' },
  ];
  const stateSegments: string[] = [];
  let personalMemory: string[] | undefined;
  let othersMemory: string[] | undefined;
  for (const section of stateSections) {
    const values = normalizeStringArray((state as Record<string, unknown>)[section.key]);
    if (!values || values.length === 0) {
      return {
        success: false,
        reason: `state.${section.key} 不能为空`,
        category: 'extraction_missing',
      };
    }
    const trimmed = values.slice(-3);
    stateSegments.push(formatStateSection(section.label, trimmed));
    if (section.key === 'personal_memory') {
      personalMemory = trimmed;
    } else if (section.key === 'others_memory') {
      othersMemory = trimmed;
    }
  }
  const innerState = stateSegments.join('\n').trim();
  if (!innerState) {
    return { success: false, reason: 'state 字段内容为空', category: 'extraction_missing' };
  }
  if (!personalMemory || !othersMemory) {
    return {
      success: false,
      reason: 'state.personal_memory / others_memory 解析失败',
      category: 'extraction_missing',
    };
  }

  const thinkValues = normalizeStringArray(node.think);
  if (!thinkValues || thinkValues.length < 2) {
    return {
      success: false,
      reason: 'think 数组至少需要 2 句',
      category: 'extraction_missing',
    };
  }
  const thinkText = thinkValues.join('\n').trim();

  const contentValues = normalizeStringArray(node.content);
  if (!contentValues || contentValues.length === 0) {
    return {
      success: false,
      reason: 'content 数组不能为空',
      category: 'extraction_missing',
    };
  }
  const contentText = contentValues.join('\n').trim();
  if (!contentText) {
    return {
      success: false,
      reason: 'content 文本为空',
      category: 'extraction_missing',
    };
  }

  const size = normalizeScaleSize(discussion?.stanceScaleSize);
  const maxLevel = Math.floor(Math.max(3, size) / 2);
  const stanceNode = node.stance;
  const stanceLocked = typeof forcedStanceScore === 'number' && Number.isFinite(forcedStanceScore);
  let score: number | undefined;
  let userLabel: string | undefined;
  if (!stanceLocked) {
    if (!stanceNode || typeof stanceNode !== 'object') {
      return { success: false, reason: '缺少 stance 字段', category: 'extraction_missing' };
    }
    score = Number((stanceNode as any).score);
    if (!Number.isFinite(score)) {
      return {
        success: false,
        reason: 'stance.score 需要为整数',
        category: 'extraction_missing',
      };
    }
    score = Math.max(-maxLevel, Math.min(maxLevel, Math.round(score)));
    userLabel =
      typeof (stanceNode as any).label === 'string' && (stanceNode as any).label.trim().length > 0
        ? (stanceNode as any).label.trim()
        : undefined;
  } else {
    score = Math.max(-maxLevel, Math.min(maxLevel, Math.round(forcedStanceScore)));
    if (stanceNode && typeof stanceNode === 'object') {
      userLabel =
        typeof (stanceNode as any).label === 'string' && (stanceNode as any).label.trim().length > 0
          ? (stanceNode as any).label.trim()
          : undefined;
    }
  }
  const positiveDesc = ensurePositiveViewpoint(discussion.positiveViewpoint);
  const negativeDesc = ensureNegativeViewpoint(discussion.negativeViewpoint);
  const fallbackLabel = (score ?? 0) > 0 ? positiveDesc : (score ?? 0) < 0 ? negativeDesc : '中立';
  const note = userLabel ?? fallbackLabel;

  return {
    success: true,
    data: {
      content: contentText,
      thoughtSummary: thinkText,
      innerState,
      stance: {
        score: score ?? 0,
        note,
      },
      normalizedRaw: cleaned,
      personalMemory,
      othersMemory,
    },
  };
};

const resolveModelConfig = (agent: AgentSpec, config: RunConfig): ModelConfig => {
  if (config.useGlobalModelConfig && config.globalModelConfig) {
    return { ...config.globalModelConfig };
  }
  if (!config.useGlobalModelConfig && agent.modelConfig) {
    return { ...agent.modelConfig };
  }
  return config.globalModelConfig ? { ...config.globalModelConfig } : defaultFallbackModel();
};

const resolveApiKey = (modelConfig: ModelConfig, vendorDefaults: VendorDefaults): string | undefined => {
  if (modelConfig.apiKey && modelConfig.apiKey.trim()) {
    return modelConfig.apiKey.trim();
  }
  const fallback = vendorDefaults?.[modelConfig.vendor]?.apiKey;
  return fallback?.trim();
};

const applyFormatCorrection = async (
  rawContent: string,
  modelConfig: ModelConfig,
  discussion: RunConfig['discussion'],
  control: ExperimentControl,
  forcedStanceScore?: number,
): Promise<{ output?: string; error?: string } | undefined> => {
  const systemPrompt =
    '你是一名格式校正助手，只负责把用户给出的文本整理成合法 JSON，不得改写事实或杜撰内容。';
  const maxLevel = Math.floor(Math.max(3, normalizeScaleSize(discussion.stanceScaleSize)) / 2);
  const stanceLocked = typeof forcedStanceScore === 'number' && Number.isFinite(forcedStanceScore);
  const userPrompt = [
    stanceLocked
      ? '请把以下模型输出重新整理为合法 JSON，仅包含 state、think、content 三个顶级字段（不要输出 stance；本轮 stance.score 将由系统写入）。'
      : '请把以下模型输出重新整理为合法 JSON，仅包含 state、think、content、stance 四个顶级字段。',
    `- state.personal_memory / others_memory / long_term / short_term 都是字符串数组，每个数组保留最近 3 条。`,
    '- think 与 content 都是字符串数组，保持原有含义，必要时拆分成多句；不要输出空数组。',
    ...(stanceLocked ? [] : [`- stance.score 必须是 [-${maxLevel}, +${maxLevel}] 范围内的整数，可保留原有 label。`]),
    '- 禁止添加除上述字段之外的键；若原文缺少某部分，可根据上下文提炼最接近的句子填入，不得凭空虚构事实。',
    '',
    'JSON 示例：',
    stanceLocked ? AGENT_OUTPUT_JSON_SCHEMA_NO_STANCE : AGENT_OUTPUT_JSON_SCHEMA,
    '',
    '===== 原始输出 =====',
    rawContent,
    '===== 原始输出结束 =====',
    '请只返回 JSON，勿添加任何解释或代码块标记。',
  ].join('\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const controller = new AbortController();
  control.inflightControllers.add(controller);
  try {
    const response =
      (await chatStream(
        messages,
        modelConfig,
        {
          temperature: Math.min(0.2, modelConfig.temperature ?? 0.7),
          maxTokens: modelConfig.max_output_tokens,
        },
        undefined,
        controller.signal,
      )) || '';
    return { output: response.trim() };
  } catch (error: any) {
    if (control.stopped) {
      return undefined;
    }
    return { error: error?.message ?? '格式校正请求失败' };
  } finally {
    control.inflightControllers.delete(controller);
  }
};

const executeAgentTurnLocal = async ({
  agent,
  agents,
  round,
  turn,
  config,
  messages,
  failures,
  agentNames,
  vendorDefaults,
  control,
}: {
  agent: AgentSpec;
  agents: AgentSpec[];
  round: number;
  turn: number;
  config: RunConfig;
  messages: Message[];
  failures: FailureRecord[];
  agentNames: Record<string, string>;
  vendorDefaults: VendorDefaults;
  control: ExperimentControl;
}): Promise<Message | undefined> => {
  const baseModelConfig = resolveModelConfig(agent, config);
  const apiKey = resolveApiKey(baseModelConfig, vendorDefaults);
  if (!apiKey) {
    throw new Error(`未找到 ${baseModelConfig.vendor} 的 API Key，请在配置页填写。`);
  }
  const modelConfig: ModelConfig = { ...baseModelConfig, apiKey };

  const previousRoundMessages =
    round > 1 ? messages.filter((message) => message.round === round - 1 && message.agentId !== agent.id) : [];
  const selfPreviousMessage =
    round > 1
      ? messages.filter((message) => message.round === round - 1 && message.agentId === agent.id).slice(-1)[0]
      : undefined;
  const lastMessage = messages[messages.length - 1];
  const lastSpeakerMessage =
    lastMessage && lastMessage.round === round && lastMessage.agentId !== agent.id ? lastMessage : undefined;

  const trustWeights = buildTrustContext(agents, config, agent.id);
  const discussion = config.discussion;
  const promptToggles: PromptToggleConfig = config.promptToggles
    ? { ...DEFAULT_PROMPT_TOGGLES, ...config.promptToggles }
    : { ...DEFAULT_PROMPT_TOGGLES };
  const randomLengthEnabled = promptToggles.randomLength !== false;
  const experimentMode = Boolean(config.personaTraversalExperiment?.enabled);
  // In experiment mode, avoid injecting additional randomness/noise.
  const contentLengthTarget =
    experimentMode ? 2 : randomLengthEnabled ? Math.floor(Math.random() * 3) + 1 : 2;
  const forcePersonalExample =
    experimentMode ? false : randomLengthEnabled ? Math.random() < 0.2 : false;
  const positiveViewpoint = ensurePositiveViewpoint(discussion?.positiveViewpoint);
  const negativeViewpoint = ensureNegativeViewpoint(discussion?.negativeViewpoint);
  const previousThoughtSummaries = collectPreviousThoughtSummaries(round - 1, agent.id, agentNames, messages);
  const previousInnerStates = collectPreviousInnerStates(round - 1, agent.id, agentNames, messages);
  const forcedStanceScore =
    round === 1 && typeof agent.initialStance === 'number' && Number.isFinite(agent.initialStance)
      ? agent.initialStance
      : undefined;

  const systemPrompt = buildAgentSystemPrompt({
    agent,
    mode: config.mode,
    round,
    turn,
    agentNames,
    trustWeights,
    stanceScaleSize: discussion.stanceScaleSize,
    positiveViewpoint,
    negativeViewpoint,
    previousRoundMessages,
    previousThoughtSummaries,
    previousInnerStates,
    promptToggles,
    contentLengthTarget,
    forcePersonalExample,
    systemPromptExtra: baseModelConfig.systemPromptExtra,
    forcedStanceScore,
  });
  const userPrompt = buildAgentUserPrompt({
    agent,
    mode: config.mode,
    round,
    turn,
    agentNames,
    trustWeights,
    stanceScaleSize: discussion.stanceScaleSize,
    positiveViewpoint,
    negativeViewpoint,
    previousRoundMessages,
    lastSpeakerMessage,
    previousThoughtSummaries,
    previousInnerStates,
    selfPreviousMessage,
    promptToggles,
    contentLengthTarget,
    forcePersonalExample,
  });

  const llmMessages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  const extra = {
    temperature: modelConfig.temperature,
    maxTokens: modelConfig.max_output_tokens,
  };

  let content = '__SKIP__';
  let thoughtSummary: string | undefined;
  let innerState: string | undefined;
  let stance: { score: number; note?: string } | undefined;
  let personalMemory: string[] | undefined;
  let othersMemory: string[] | undefined;
  let rawResponse: string | undefined;
  let lastRawOutput: string | undefined;
  let finalFailureDetails:
    | { category: FailureRecord['category']; reasons: string[] }
    | undefined;

  let attempt = 0;
  while (attempt < MAX_AGENT_OUTPUT_ATTEMPTS) {
    attempt += 1;
    if (control.stopped) return undefined;

    let attemptFailureDetails:
      | { category: FailureRecord['category']; reasons: string[] }
      | undefined;
    const controller = new AbortController();
    control.inflightControllers.add(controller);
    let rawContent = '';
    try {
      rawContent =
        (await chatStream(
          llmMessages,
          modelConfig,
          extra,
          undefined,
          controller.signal,
        )) || '';
    } catch (error: any) {
      if (control.stopped) {
        control.inflightControllers.delete(controller);
        return undefined;
      }
      attemptFailureDetails = {
        category: 'request_error',
        reasons: [error?.message ?? 'LLM 请求异常'],
      };
    } finally {
      control.inflightControllers.delete(controller);
    }

    rawResponse = rawContent;
    lastRawOutput = rawContent;
    if (!rawContent || rawContent.trim().length === 0) {
      attemptFailureDetails = {
        category: 'response_empty',
        reasons: ['模型输出为空'],
      };
    } else if (!attemptFailureDetails) {
      let parseResult = parseAgentJsonOutput(rawContent, discussion, forcedStanceScore);
      let formatCorrectionAttempted = false;
      let formatCorrectionError: string | undefined;
      if (!parseResult.success) {
        const correctionResult = await applyFormatCorrection(rawContent, modelConfig, discussion, control, forcedStanceScore);
        if (control.stopped) return undefined;
        if (correctionResult) {
          formatCorrectionAttempted = true;
          if (correctionResult.output) {
            const corrected = correctionResult.output.trim();
            if (corrected.length > 0) {
              lastRawOutput = corrected;
              rawResponse = corrected;
              parseResult = parseAgentJsonOutput(corrected, discussion, forcedStanceScore);
            }
          }
          if (correctionResult.error) {
            formatCorrectionError = correctionResult.error;
          }
        }
      }
      if (parseResult.success && parseResult.data) {
        content = parseResult.data.content;
        thoughtSummary = parseResult.data.thoughtSummary;
        innerState = parseResult.data.innerState;
        stance = parseResult.data.stance;
        personalMemory = parseResult.data.personalMemory;
        othersMemory = parseResult.data.othersMemory;
        break;
      }
      const category = formatCorrectionAttempted ? 'format_correction_failed' : 'extraction_missing';
      const reason =
        formatCorrectionError ??
        (formatCorrectionAttempted ? '格式校正助手仍未能生成合法 JSON。' : (parseResult.reason ?? '输出解析失败'));
      attemptFailureDetails = { category, reasons: [reason] };
    }

    if (attemptFailureDetails) {
      finalFailureDetails = attemptFailureDetails;
    }
  }

  if (finalFailureDetails && content === '__SKIP__') {
    failures.push({
      id: nanoid(),
      agentId: agent.id,
      agentName: agent.name,
      round,
      turn,
      category: finalFailureDetails.category,
      reason: finalFailureDetails.reasons.join('；'),
      timestamp: Date.now(),
      systemPrompt,
      userPrompt,
      rawOutput: lastRawOutput ?? rawResponse,
      errorMessage: undefined,
    });
  }

  const message: Message = {
    id: nanoid(),
    agentId: agent.id,
    agentName: agent.name,
    role: 'assistant',
    content,
    rawContent: rawResponse,
    ts: Date.now(),
    round,
    turn,
    systemPrompt,
    userPrompt,
    stance,
    thoughtSummary,
    innerState,
    personalMemory,
    othersMemory,
  };
  return message;
};

