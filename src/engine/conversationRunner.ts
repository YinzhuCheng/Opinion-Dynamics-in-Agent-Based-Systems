import { nanoid } from 'nanoid';
import {
  buildAgentSystemPrompt,
  buildAgentUserPrompt,
  AGENT_OUTPUT_JSON_SCHEMA,
} from './prompts';
import type {
  AgentSpec,
  FailureRecord,
  Message,
  ModelConfig,
  RunConfig,
  RunStatus,
  PromptToggleConfig,
} from '../types';
import { DEFAULT_PROMPT_TOGGLES } from '../types';
import { useAppStore } from '../store/useAppStore';
import { chatStream } from '../utils/llmAdapter';
import type { ChatMessage } from '../utils/llmAdapter';
import {
  ensureNegativeViewpoint,
  ensurePositiveViewpoint,
} from '../constants/discussion';

type RunnerMode = 'fresh' | 'resume';
type ConversationProgress = {
  startRound: number;
  startTurnIndex: number;
  spokenMap: Map<number, string[]>;
  pendingAgentId?: string;
};

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

let activeRunner: ConversationRunner | undefined;
let currentRunRevision = 0;
const PRIVATE_MEMORY_WINDOW = 3;

const runConversation = async (mode: RunnerMode) => {
  const revision = ++currentRunRevision;
  if (activeRunner) {
    activeRunner.forceStop();
  }
  if (mode === 'fresh') {
    useAppStore.getState().setResult(undefined);
  }
  const runner = new ConversationRunner(mode, revision);
  activeRunner = runner;
  try {
    await runner.run();
  } finally {
    if (activeRunner === runner) {
      activeRunner = undefined;
    }
  }
};

export const startConversation = async () => {
  await runConversation('fresh');
};

export const refreshConversation = async () => {
  const state = useAppStore.getState();
  if (state.runState.messages.length === 0) {
    throw new Error('暂无可刷新内容，请先开始一次对话。');
  }
  await runConversation('resume');
};

export const stopConversation = () => {
  activeRunner?.requestPause();
};

export const resumeConversation = () => {
  activeRunner?.resume();
};

class ConversationRunner {
  private stopped = false;
  private paused = false;
  private pauseRequested = false;
  private resumeResolver?: () => void;
  private readonly appStore = useAppStore;
  private readonly runMode: RunnerMode;
  private readonly runRevision: number;
  private sequentialOrder?: string[];
  private inflightControllers = new Set<AbortController>();

  constructor(runMode: RunnerMode = 'fresh', runRevision: number) {
    this.runMode = runMode;
    this.runRevision = runRevision;
  }

  requestPause() {
    if (!this.isCurrentRun() || this.stopped || this.paused || this.pauseRequested) {
      return;
    }
    this.pauseRequested = true;
    this.setStopRequested(true);
    this.setStatus((status) => ({
      ...status,
      phase: 'paused',
      awaitingLabel: undefined,
    }));
  }

  resume() {
    if (!this.isCurrentRun() || this.stopped) {
      return;
    }
    if (this.paused && this.resumeResolver) {
      const resolver = this.resumeResolver;
      this.resumeResolver = undefined;
      this.paused = false;
      this.setStopRequested(false);
      this.setStatus((status) => ({
        ...status,
        phase: 'running',
      }));
      resolver();
      return;
    }
    if (this.pauseRequested) {
      this.pauseRequested = false;
      this.setStopRequested(false);
      this.setStatus((status) => ({
        ...status,
        phase: 'running',
      }));
    }
  }

  forceStop() {
    if (this.stopped) return;
    this.stopped = true;
    this.pauseRequested = false;
    this.inflightControllers.forEach((controller) => controller.abort());
    this.inflightControllers.clear();
    if (this.resumeResolver) {
      const resolver = this.resumeResolver;
      this.resumeResolver = undefined;
      resolver();
    }
  }

    async run() {
      const state = this.appStore.getState();
      const { runState } = state;
      const { agents, config } = runState;

      if (agents.length === 0) {
        this.setStatus({
          phase: 'error',
          mode: config.mode,
          error: '请至少配置 1 名 Agent 后再开始对话。',
          currentRound: 0,
          currentTurn: 0,
          totalMessages: 0,
          summarizedCount: 0,
          startedAt: Date.now(),
          finishedAt: Date.now(),
        });
        return;
      }

      const preserveHistory = this.runMode === 'resume';
      if (config.mode === 'sequential' && !preserveHistory) {
        this.sequentialOrder = agents.map((agent) => agent.id);
      } else if (config.mode === 'sequential' && !this.sequentialOrder) {
        this.sequentialOrder = agents.map((agent) => agent.id);
      }

      this.setStopRequested(false);
      this.stopped = false;
      this.pauseRequested = false;
      this.paused = false;
      this.resumeResolver = undefined;

      let startedAt = runState.status.startedAt ?? Date.now();

      if (!preserveHistory) {
        this.resetMessages();
        startedAt = Date.now();
        this.setStatus({
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
        });
      } else {
        const currentStatus = this.appStore.getState().runState.status;
        startedAt = currentStatus.startedAt ?? startedAt;
        this.setStatus({
          ...currentStatus,
          phase: 'running',
          startedAt,
          finishedAt: undefined,
          error: undefined,
          awaitingLabel: undefined,
        });
      }

    const progress = preserveHistory
      ? this.analyzeProgress(
          config.mode === 'sequential'
            ? this.ensureSequentialOrder(agents).map((agent) => agent.id)
            : agents.map((agent) => agent.id),
        )
      : undefined;

    try {
        if (config.mode === 'sequential') {
          await this.runSequentialOrder(agents, config, progress);
        } else {
          await this.runRandomOrder(agents, config, progress);
        }
      const { status } = this.appStore.getState().runState;
        if (!this.stopped && status.phase !== 'error') {
          this.setStatus({
            ...status,
            phase: 'completed',
            finishedAt: Date.now(),
            awaitingLabel: undefined,
          });
        } else if (this.stopped) {
          this.setStatus((status) => ({
            ...status,
            phase: status.phase === 'error' ? status.phase : 'cancelled',
            finishedAt: Date.now(),
            awaitingLabel: undefined,
          }));
      }
      this.captureResultSnapshot();
    } catch (error: any) {
        this.setStatus({
          phase: 'error',
          mode: config.mode,
          currentRound: this.appStore.getState().runState.status.currentRound,
          currentTurn: this.appStore.getState().runState.status.currentTurn,
          totalMessages: this.appStore.getState().runState.status.totalMessages,
          summarizedCount: this.appStore.getState().runState.status.summarizedCount,
          error: error?.message ?? '运行过程中发生未知错误。',
          startedAt,
          finishedAt: Date.now(),
          lastAgentId: this.appStore.getState().runState.status.lastAgentId,
          awaitingLabel: undefined,
        });
      throw error;
    }
  }

    private analyzeProgress(agentIds: string[]): ConversationProgress {
      const messages = this.appStore.getState().runState.messages;
      const spokenMap = new Map<number, string[]>();
      if (messages.length === 0) {
        return { startRound: 1, startTurnIndex: 0, spokenMap };
      }
      let lastRound = 1;
      let lastTurnIndex = 0;
      messages.forEach((message) => {
        const round = Math.max(1, message.round || 1);
        if (!spokenMap.has(round)) {
          spokenMap.set(round, []);
        }
        const list = spokenMap.get(round)!;
        if (!list.includes(message.agentId)) {
          list.push(message.agentId);
        }
        const rawTurn =
          typeof message.turn === 'number' && Number.isFinite(message.turn) ? message.turn : list.length;
        if (round > lastRound || (round === lastRound && rawTurn >= lastTurnIndex)) {
          lastRound = round;
          lastTurnIndex = rawTurn;
        }
      });
      const agentCount = Math.max(1, agentIds.length);
      let startRound = Math.max(1, lastRound);
      let startTurnIndex = Math.max(0, lastTurnIndex);
      if (lastTurnIndex >= agentCount) {
        startRound = lastRound + 1;
        startTurnIndex = 0;
      }
      const statusSnapshot = this.appStore.getState().runState.status;
      const spokenInStartRound = spokenMap.get(startRound) ?? [];
      const shouldPrioritize =
        statusSnapshot.lastAgentId &&
        statusSnapshot.currentRound === startRound &&
        typeof statusSnapshot.currentTurn === 'number' &&
        statusSnapshot.currentTurn === spokenInStartRound.length + 1 &&
        !spokenInStartRound.includes(statusSnapshot.lastAgentId);
      const pendingAgentId = shouldPrioritize ? statusSnapshot.lastAgentId : undefined;
      return {
        startRound,
        startTurnIndex,
        spokenMap,
        pendingAgentId,
      };
    }

  private ensureSequentialOrder(agents: AgentSpec[]): AgentSpec[] {
    if (!this.sequentialOrder) {
      this.sequentialOrder = agents.map((agent) => agent.id);
    }
    const existingSet = new Set(this.sequentialOrder);
    agents.forEach((agent) => {
      if (!existingSet.has(agent.id)) {
        this.sequentialOrder!.push(agent.id);
        existingSet.add(agent.id);
      }
    });
    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
    this.sequentialOrder = this.sequentialOrder.filter((id) => agentMap.has(id));
    return this.sequentialOrder.map((id) => agentMap.get(id)!).filter((agent): agent is AgentSpec => Boolean(agent));
  }

  private async runSequentialOrder(
    agents: AgentSpec[],
    config: RunConfig,
    progress?: ConversationProgress,
  ) {
    const orderedAgents = this.ensureSequentialOrder(agents);
    const maxRounds = config.maxRounds ?? 3;
    const startRound = progress?.startRound ?? 1;
    const normalizedStartTurn = progress
      ? Math.min(orderedAgents.length, Math.max(0, progress.startTurnIndex))
      : 0;
    for (let round = 1; round <= maxRounds; round += 1) {
      if (round < startRound) {
        continue;
      }
      await this.waitIfPaused();
      if (this.shouldStop()) break;
      const turnStart = round === startRound ? normalizedStartTurn : 0;
      if (turnStart >= orderedAgents.length) {
        continue;
      }
      for (let turn = turnStart; turn < orderedAgents.length; turn += 1) {
        await this.waitIfPaused();
        if (this.shouldStop()) break;
        const agent = orderedAgents[turn];
        this.setStatus((status) => ({
          ...status,
          currentRound: round,
          currentTurn: turn + 1,
          lastAgentId: agent.id,
        }));
        await this.executeAgentTurn(agent, round, turn + 1, config);
        if (this.shouldStop()) break;
      }
    }
  }

  private async runRandomOrder(
      agents: AgentSpec[],
      config: RunConfig,
      progress?: ConversationProgress,
    ) {
      const maxRounds = config.maxRounds ?? 3;
      const startRound = progress?.startRound ?? 1;
      const spokenMap = progress?.spokenMap ?? new Map<number, string[]>();
      for (let round = 1; round <= maxRounds; round += 1) {
        if (round < startRound) {
          continue;
        }
        await this.waitIfPaused();
        if (this.shouldStop()) break;
        const spokenIds = spokenMap.get(round) ?? [];
        const priorityId = round === startRound ? progress?.pendingAgentId : undefined;
        const roundOrder = this.buildRoundOrderForRandom(agents, spokenIds, priorityId);
        const turnStart = round === startRound ? Math.min(spokenIds.length, roundOrder.length) : 0;
        if (turnStart >= roundOrder.length) {
          continue;
        }
        for (let turn = turnStart; turn < roundOrder.length; turn += 1) {
          await this.waitIfPaused();
          if (this.shouldStop()) break;
          const agent = roundOrder[turn];
          this.setStatus((status) => ({
            ...status,
            currentRound: round,
            currentTurn: turn + 1,
            lastAgentId: agent.id,
          }));
          await this.executeAgentTurn(agent, round, turn + 1, config);
          if (this.shouldStop()) break;
        }
    }
    }

  private async executeAgentTurn(
    agent: AgentSpec,
    round: number,
    turn: number,
    config: RunConfig,
  ): Promise<Message | undefined> {
    const baseModelConfig = this.resolveModelConfig(agent, config);
    const apiKey = this.resolveApiKey(baseModelConfig);

    if (!apiKey) {
      throw new Error(`未找到 ${baseModelConfig.vendor} 的 API Key，请在配置页填写。`);
    }
    const modelConfig: ModelConfig = { ...baseModelConfig, apiKey };

        const agentNames = this.getAgentNameMap();
        const { previousRoundMessages, lastSpeakerMessage, selfPreviousMessage } = this.buildRoundContext(
          round,
          agent.id,
        );
        const visibleWindow = [...previousRoundMessages];
        if (lastSpeakerMessage) {
          visibleWindow.push(lastSpeakerMessage);
        }
        this.updateVisibleWindow(visibleWindow);
        const trustWeights = this.buildTrustContext(agent.id);
        const configSnapshot = this.appStore.getState().runState.config;
        const discussion = configSnapshot.discussion;
        const promptToggles = this.getPromptToggles();
        const randomLengthEnabled = promptToggles.randomLength !== false;
        const contentLengthTarget = randomLengthEnabled ? Math.floor(Math.random() * 3) + 1 : 2;
        const forcePersonalExample = randomLengthEnabled ? Math.random() < 0.2 : false;
          const positiveViewpoint = ensurePositiveViewpoint(discussion?.positiveViewpoint);
          const negativeViewpoint = ensureNegativeViewpoint(discussion?.negativeViewpoint);
          const previousThoughtSummaries = this.collectPreviousThoughtSummaries(round - 1, agent.id, agentNames);
          const previousInnerStates = this.collectPreviousInnerStates(round - 1, agent.id, agentNames);

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

    const messages: ChatMessage[] = [
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
    let failureDetails:
      | { category: FailureRecord['category']; reasons: string[] }
      | undefined;

    const controller = new AbortController();
    this.inflightControllers.add(controller);
    let rawContent = '';
    try {
      rawContent =
        (await chatStream(
          messages,
          modelConfig,
          extra,
          {
            onStatus: (status) => {
              if (status === 'waiting_response' || status === 'responding') {
                this.setAwaiting('response');
              } else if (status === 'thinking') {
                this.setAwaiting('thinking');
              } else if (status === 'done') {
                this.setAwaiting(undefined);
              }
            },
          },
          controller.signal,
        )) || '';
    } catch (error: any) {
      if (this.isAbortError(error)) {
        this.inflightControllers.delete(controller);
        return undefined;
      }
      this.logFailure({
        agent,
        round,
        turn,
        category: 'request_error',
        reason: error?.message ?? 'LLM 请求异常',
        systemPrompt,
        userPrompt,
        rawOutput: lastRawOutput,
        errorMessage: error ? String(error.stack ?? error) : undefined,
      });
      throw error;
    } finally {
      this.setAwaiting(undefined);
      this.inflightControllers.delete(controller);
    }

    rawContent = rawContent.trim();
    lastRawOutput = rawContent;

    if (!rawContent || rawContent === '__SKIP__') {
      failureDetails = {
        category: 'response_empty',
        reasons: ['模型返回空内容或 __SKIP__ 标记，无法解析。'],
      };
      rawResponse = undefined;
    } else {
      rawResponse = rawContent;
      let parseResult = this.parseAgentJsonOutput(rawContent, discussion);
      let formatCorrectionAttempted = false;
      let formatCorrectionError: string | undefined;
      if (!parseResult.success) {
        const correctionResult = await this.applyFormatCorrection(
          rawContent,
          modelConfig,
          discussion,
        );
        if (correctionResult) {
          formatCorrectionAttempted = true;
          if (correctionResult.output) {
            const corrected = correctionResult.output.trim();
            if (corrected.length > 0) {
              lastRawOutput = corrected;
              rawResponse = corrected;
              parseResult = this.parseAgentJsonOutput(corrected, discussion);
            }
          }
          if (correctionResult.error) {
            formatCorrectionError = correctionResult.error;
          }
        }
      }

      if (parseResult.success && parseResult.data) {
        const parsed = parseResult.data;
        content = parsed.content;
        thoughtSummary = parsed.thoughtSummary;
        innerState = parsed.innerState;
        stance = parsed.stance;
          personalMemory = parsed.personalMemory;
          othersMemory = parsed.othersMemory;
        rawResponse = parsed.normalizedRaw ?? rawResponse;
      } else {
        const category = formatCorrectionAttempted
          ? 'format_correction_failed'
          : parseResult.category ?? 'extraction_missing';
        const reason =
          parseResult.reason ??
          formatCorrectionError ??
          (formatCorrectionAttempted
            ? '格式校正助手仍未能生成合法 JSON。'
            : '输出解析失败，缺少必需字段。');
        failureDetails = {
          category,
          reasons: [reason],
        };
        content = '__SKIP__';
        thoughtSummary = undefined;
        innerState = undefined;
        stance = undefined;
        rawResponse = undefined;
      }
    }

    if (failureDetails) {
      const reasonText =
        failureDetails.reasons.length > 0
          ? failureDetails.reasons.join('；')
          : '未能解析有效输出';
      this.logFailure({
        agent,
        round,
        turn,
        category: failureDetails.category,
        reason: reasonText,
        systemPrompt,
        userPrompt,
        rawOutput: lastRawOutput,
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
      thoughtSummary,
      innerState,
      personalMemory,
      othersMemory,
    };
    if (stance) {
      message.stance = stance;
    }

    this.appendMessageSnapshot(message);
    this.updateStatusAfterMessage(message);

    return message;
  }

  private isAbortError(error: unknown): boolean {
    if (!error) return false;
    if (typeof error === 'object' && (error as any).name === 'AbortError') {
      return true;
    }
    return String(error).includes('AbortError');
  }

  private updateStatusAfterMessage(message: Message) {
    this.setStatus((status) => ({
      ...status,
      totalMessages: status.totalMessages + (message.content === '__SKIP__' ? 0 : 1),
    }));
  }

  private buildRoundOrderForRandom(
    agents: AgentSpec[],
    spokenIds: string[],
    priorityId?: string,
  ): AgentSpec[] {
    if (spokenIds.length === 0 && !priorityId) {
      return this.shuffleAgentsList(agents);
    }
    const spokenSet = new Set(spokenIds);
    const spokenAgents = spokenIds
      .map((id) => agents.find((agent) => agent.id === id))
      .filter((agent): agent is AgentSpec => Boolean(agent));
    const remainingAgents = agents.filter((agent) => !spokenSet.has(agent.id));
    let priorityAgent: AgentSpec | undefined;
    const others: AgentSpec[] = [];
    remainingAgents.forEach((agent) => {
      if (priorityId && agent.id === priorityId) {
        priorityAgent = agent;
      } else {
        others.push(agent);
      }
    });
    const shuffledOthers = this.shuffleAgentsList(others);
    const orderedTail = priorityAgent ? [priorityAgent, ...shuffledOthers] : shuffledOthers;
    return [...spokenAgents, ...orderedTail];
  }

    private buildTrustContext(agentId: string): Array<{ agentName: string; weight: number }> {
      const state = this.appStore.getState();
      const trustRow = state.runState.config.trustMatrix[agentId];
      const entries = state.runState.agents.map((agent) => {
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
    }

  private getPromptToggles(): PromptToggleConfig {
    const toggles = this.appStore.getState().runState.config.promptToggles;
    return toggles ? { ...DEFAULT_PROMPT_TOGGLES, ...toggles } : { ...DEFAULT_PROMPT_TOGGLES };
  }

      private getAgentNameMap(): Record<string, string> {
        const agents = this.appStore.getState().runState.agents;
        return agents.reduce<Record<string, string>>((map, agent) => {
          map[agent.id] = agent.name;
          return map;
        }, {});
      }

  private buildRoundContext(
    round: number,
    agentId: string,
  ): {
        previousRoundMessages: Message[];
        lastSpeakerMessage?: Message;
        selfPreviousMessage?: Message;
      } {
        const messages = this.appStore.getState().runState.messages;
        const previousRoundMessages =
      round > 1
        ? messages.filter(
            (message) => message.round === round - 1 && message.agentId !== agentId,
          )
        : [];
    const selfPreviousMessage =
      round > 1
        ? messages
            .filter((message) => message.round === round - 1 && message.agentId === agentId)
            .slice(-1)[0]
        : undefined;
        const lastMessage = messages[messages.length - 1];
        const lastSpeakerMessage =
          lastMessage && lastMessage.round === round && lastMessage.agentId !== agentId
            ? lastMessage
            : undefined;
    return { previousRoundMessages, lastSpeakerMessage, selfPreviousMessage };
      }

        private collectPreviousThoughtSummaries(
          round: number,
          agentId: string,
          agentNames: Record<string, string>,
        ): Array<{ agentName: string; thoughtSummary: string; round: number }> {
          if (round <= 0) return [];
          const messages = this.appStore.getState().runState.messages;
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
        }

        private collectPreviousInnerStates(
          round: number,
          agentId: string,
          agentNames: Record<string, string>,
        ): Array<{ agentName: string; innerState: string; round: number }> {
          if (round <= 0) return [];
          const messages = this.appStore.getState().runState.messages;
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
        innerState: this.removeOthersMemorySection(message.innerState),
        round: message.round,
      }))
      .filter((entry) => entry.innerState.length > 0);
        }

  private parseAgentJsonOutput(
    rawContent: string,
    discussion: RunConfig['discussion'],
  ): ParseAgentJsonResult {
    const cleaned = this.stripCodeFences(rawContent).trim();
    if (!cleaned) {
      return { success: false, reason: '输出内容为空', category: 'extraction_missing' };
    }
    let parsed: any;
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

    const state = parsed.state;
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
      const values = this.normalizeStringArray((state as Record<string, unknown>)[section.key]);
      if (!values || values.length === 0) {
        return {
          success: false,
          reason: `state.${section.key} 不能为空`,
          category: 'extraction_missing',
        };
      }
      const trimmed = values.slice(-3);
      stateSegments.push(this.formatStateSection(section.label, trimmed));
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

    const thinkValues = this.normalizeStringArray(parsed.think);
    if (!thinkValues || thinkValues.length < 2) {
      return {
        success: false,
        reason: 'think 数组至少需要 2 句',
        category: 'extraction_missing',
      };
    }
    const thinkText = thinkValues.join('\n').trim();

    const contentValues = this.normalizeStringArray(parsed.content);
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

    const stanceNode = parsed.stance;
    if (!stanceNode || typeof stanceNode !== 'object') {
      return { success: false, reason: '缺少 stance 字段', category: 'extraction_missing' };
    }
    let score = Number((stanceNode as any).score);
    if (!Number.isFinite(score)) {
      return {
        success: false,
        reason: 'stance.score 需要为整数',
        category: 'extraction_missing',
      };
    }
    const size = normalizeScaleSize(discussion?.stanceScaleSize);
    const maxLevel = Math.floor(Math.max(3, size) / 2);
    score = Math.max(-maxLevel, Math.min(maxLevel, Math.round(score)));
    const userLabel =
      typeof stanceNode.label === 'string' && stanceNode.label.trim().length > 0
        ? stanceNode.label.trim()
        : undefined;
    const positiveDesc = ensurePositiveViewpoint(discussion.positiveViewpoint);
    const negativeDesc = ensureNegativeViewpoint(discussion.negativeViewpoint);
    const fallbackLabel = score > 0 ? positiveDesc : score < 0 ? negativeDesc : '中立';
    const note = userLabel ?? fallbackLabel;

    return {
      success: true,
      data: {
        content: contentText,
        thoughtSummary: thinkText,
        innerState,
        stance: {
          score,
          note,
        },
        normalizedRaw: cleaned,
          personalMemory,
          othersMemory,
      },
    };
  }

  private normalizeStringArray(value: unknown): string[] | undefined {
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
  }

  private formatStateSection(label: string, values: string[]): string {
    const lines = values.map((item) => `- ${item}`).join('\n');
    return `【${label}】\n${lines}`;
  }

  private removeOthersMemorySection(innerState?: string): string {
    if (!innerState) return '';
    const sanitized = innerState
      .replace(/【他人发言记忆】[\s\S]*?(?=【[^】]+】|$)/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return sanitized;
  }

  private stripCodeFences(text: string): string {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
      return match[1];
    }
    return text;
  }

  private async applyFormatCorrection(
    rawContent: string,
    modelConfig: ModelConfig,
    discussion: RunConfig['discussion'],
  ): Promise<{ output?: string; error?: string } | undefined> {
    const systemPrompt =
      '你是一名格式校正助手，只负责把用户给出的文本整理成合法 JSON，不得改写事实或杜撰内容。';
    const maxLevel = Math.floor(Math.max(3, normalizeScaleSize(discussion.stanceScaleSize)) / 2);
    const userPrompt = [
      '请把以下模型输出重新整理为合法 JSON，仅包含 state、think、content、stance 四个顶级字段。',
      `- state.personal_memory / others_memory / long_term / short_term 都是字符串数组，每个数组保留最近 3 条。`,
      '- think 与 content 都是字符串数组，保持原有含义，必要时拆分成多句；不要输出空数组。',
      `- stance.score 必须是 [-${maxLevel}, +${maxLevel}] 范围内的整数，可保留原有 label。`,
      '- 禁止添加除上述字段之外的键；若原文缺少某部分，可根据上下文提炼最接近的句子填入，不得凭空虚构事实。',
      '',
      'JSON 示例：',
      AGENT_OUTPUT_JSON_SCHEMA,
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
    this.inflightControllers.add(controller);
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
      if (this.isAbortError(error)) {
        return undefined;
      }
      return { error: error?.message ?? '格式校正请求失败' };
    } finally {
      this.inflightControllers.delete(controller);
    }
  }

    private resolveModelConfig(agent: AgentSpec, config: RunConfig): ModelConfig {
    if (config.useGlobalModelConfig && config.globalModelConfig) {
      return { ...config.globalModelConfig };
    }
    if (!config.useGlobalModelConfig && agent.modelConfig) {
      return { ...agent.modelConfig };
    }
    // fallback to default global
    return config.globalModelConfig ? { ...config.globalModelConfig } : defaultFallbackModel();
  }

  private resolveApiKey(modelConfig: ModelConfig): string | undefined {
    if (modelConfig.apiKey && modelConfig.apiKey.trim()) {
      return modelConfig.apiKey.trim();
    }
    const vendorDefaults = this.appStore.getState().vendorDefaults;
    const fallback = vendorDefaults[modelConfig.vendor]?.apiKey;
    return fallback?.trim();
  }

  private setStatus(updater: Partial<RunStatus> | ((status: RunStatus) => RunStatus)) {
    this.runIfCurrent(() => {
      this.appStore.getState().setRunStatus((status) => {
        const next =
          typeof updater === 'function'
            ? (updater as (current: RunStatus) => RunStatus)(status)
            : { ...status, ...updater };
        return {
          ...next,
          sessionId: this.runRevision,
        };
      });
    });
  }

  private setStopRequested(value: boolean) {
    this.runIfCurrent(() => {
      this.appStore.getState().setStopRequested(value);
    });
  }

  private resetMessages() {
    this.runIfCurrent(() => {
      this.appStore.getState().resetMessages();
    });
  }

  private updateVisibleWindow(messages: Message[]) {
    this.runIfCurrent(() => {
      this.appStore.getState().setVisibleWindow(messages);
    });
  }

    private logFailure(details: {
      agent: AgentSpec;
      round: number;
      turn: number;
      category: FailureRecord['category'];
      reason: string;
      systemPrompt?: string;
      userPrompt?: string;
      rawOutput?: string;
      errorMessage?: string;
    }) {
      this.appendFailureRecord({
        id: nanoid(),
        agentId: details.agent.id,
        agentName: details.agent.name,
        round: details.round,
        turn: details.turn,
        category: details.category,
        reason: details.reason,
        timestamp: Date.now(),
        systemPrompt: details.systemPrompt,
        userPrompt: details.userPrompt,
        rawOutput: details.rawOutput,
        errorMessage: details.errorMessage,
      });
    }

    private appendMessageSnapshot(message: Message) {
    this.runIfCurrent(() => {
      this.appStore.getState().appendMessage(message);
    });
  }

    private appendFailureRecord(record: FailureRecord) {
      this.runIfCurrent(() => {
        this.appStore.getState().appendFailureRecord(record);
      });
    }

  private setAwaiting(label?: 'response' | 'thinking') {
    this.setStatus((status) => ({
      ...status,
      awaitingLabel: label,
    }));
  }

  private isCurrentRun() {
    return this.runRevision === currentRunRevision;
  }

  private runIfCurrent(action: () => void) {
    if (!this.isCurrentRun()) {
      return;
    }
    action();
  }

  private async waitIfPaused() {
    if (this.stopped) return;
    if (!this.pauseRequested && !this.paused) {
      return;
    }
      if (!this.paused) {
        this.pauseRequested = false;
        this.paused = true;
        this.setStopRequested(false);
      }
    await new Promise<void>((resolve) => {
      this.resumeResolver = resolve;
    });
    this.resumeResolver = undefined;
    this.paused = false;
  }

  private shouldStop() {
    return this.stopped;
  }

  private captureResultSnapshot() {
    this.runIfCurrent(() => {
      const state = this.appStore.getState().runState;
      const status = state.status;
      this.appStore.getState().setResult({
        messages: state.messages,
        finishedAt: status.finishedAt ?? Date.now(),
        summary: state.summary,
        configSnapshot: state.config,
          status,
          failures: state.failureRecords,
      });
    });
  }

    private shuffleAgentsList(agents: AgentSpec[]): AgentSpec[] {
      const order = [...agents];
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      return order;
    }
}

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
