import { nanoid } from 'nanoid';
import { buildAgentSystemPrompt, buildAgentUserPrompt } from './prompts';
import type { AgentSpec, Message, ModelConfig, RunConfig, RunStatus } from '../types';
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

let activeRunner: ConversationRunner | undefined;
let currentRunRevision = 0;

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
        const discussion = this.appStore.getState().runState.config.discussion;
          const positiveViewpoint = ensurePositiveViewpoint(discussion?.positiveViewpoint);
          const negativeViewpoint = ensureNegativeViewpoint(discussion?.negativeViewpoint);
          const previousThoughtSummaries = this.collectPreviousThoughtSummaries(round - 1, agentNames);
          const previousInnerStates = this.collectPreviousInnerStates(round - 1, agentNames);

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
        });

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const extra = {
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.max_output_tokens,
    };

    const controller = new AbortController();
    this.inflightControllers.add(controller);
    let content = '';
    try {
      content =
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
      throw error;
    } finally {
      this.setAwaiting(undefined);
      this.inflightControllers.delete(controller);
    }

      content = content.trim() || '__SKIP__';

      let thoughtSummary: string | undefined;
      let innerState: string | undefined;
      if (content !== '__SKIP__') {
        const metadataResult = this.extractThinkingArtifacts(content);
        thoughtSummary = metadataResult.thoughtSummary;
        innerState = metadataResult.innerState;
        let processedContent = metadataResult.content.trim();
        if (!processedContent) {
          const fallbackSegments: string[] = [];
          if (metadataResult.thoughtSummary) {
            fallbackSegments.push(`【思考摘要补全】${metadataResult.thoughtSummary}`);
          }
          if (metadataResult.innerState) {
            fallbackSegments.push(`【内在状态参考】${metadataResult.innerState}`);
          }
          processedContent = fallbackSegments.join('\n').trim();
        }
        if (!processedContent) {
          processedContent = metadataResult.rawContent.trim();
        }
        content = processedContent || '__SKIP__';
      }
      if (content === '__SKIP__') {
        thoughtSummary = undefined;
        innerState = undefined;
      }

        const stanceResult = this.processSelfReportedStance(content, discussion);
        content = stanceResult.content;

    const message: Message = {
      id: nanoid(),
      agentId: agent.id,
        agentName: agent.name,
      role: 'assistant',
      content,
      ts: Date.now(),
      round,
      turn,
      systemPrompt,
      userPrompt,
          thoughtSummary,
          innerState,
    };
    if (stanceResult.stance) {
      message.stance = stanceResult.stance;
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
          agentNames: Record<string, string>,
        ): Array<{ agentName: string; thoughtSummary: string }> {
          if (round <= 0) return [];
          const messages = this.appStore.getState().runState.messages;
          return messages
            .filter(
              (message) =>
                message.round === round &&
                typeof message.thoughtSummary === 'string' &&
                message.thoughtSummary.trim().length > 0,
            )
            .map((message) => ({
              agentName: agentNames[message.agentId] ?? message.agentId,
              thoughtSummary: (message.thoughtSummary ?? '').trim(),
            }));
        }

        private collectPreviousInnerStates(
          round: number,
          agentNames: Record<string, string>,
        ): Array<{ agentName: string; innerState: string }> {
          if (round <= 0) return [];
          const messages = this.appStore.getState().runState.messages;
          return messages
            .filter(
              (message) =>
                message.round === round &&
                typeof message.innerState === 'string' &&
                message.innerState.trim().length > 0,
            )
            .map((message) => ({
              agentName: agentNames[message.agentId] ?? message.agentId,
              innerState: (message.innerState ?? '').trim(),
            }));
        }

    private extractThinkingArtifacts(content: string): {
      content: string;
      thoughtSummary?: string;
      innerState?: string;
      foundState: boolean;
      foundThought: boolean;
      rawContent: string;
    } {
      const stateResult = this.extractTaggedBlock(content, 'STATE');
      const innerState = stateResult.value?.trim() || undefined;
      let workingContent = stateResult.content;

      const thoughtTags = ['THINK', 'THOUGHT', 'PSY'];
      let thoughtSummary: string | undefined;
      let foundThought = false;
      for (const tag of thoughtTags) {
        const result = this.extractTaggedBlock(workingContent, tag);
        if (result.found && result.value) {
          thoughtSummary = result.value?.trim() || undefined;
          workingContent = result.content;
          foundThought = Boolean(thoughtSummary);
          break;
        }
      }

      return {
        content: workingContent.trim(),
        thoughtSummary,
        innerState,
        foundState: Boolean(stateResult.found && innerState),
        foundThought,
        rawContent: content,
      };
    }

    private extractTaggedBlock(
      content: string,
      tag: string,
    ): { content: string; value?: string; found: boolean } {
      const closingRegex = new RegExp(`\\[\\[${tag}\\]\\]([\\s\\S]*?)\\[\\[\\/${tag}\\]\\]`, 'i');
      const closingMatch = content.match(closingRegex);
      if (closingMatch && typeof closingMatch.index === 'number') {
        const before = content.slice(0, closingMatch.index);
        const after = content.slice(closingMatch.index + closingMatch[0].length);
        const remaining = `${before}${after}`.trim();
        const value = closingMatch[1].trim();
        return {
          content: remaining,
          value: value.length > 0 ? value : undefined,
          found: true,
        };
      }
      const legacyRegex = new RegExp(`\\[\\[${tag}\\]\\]([\\s\\S]*?)$`, 'i');
      const legacyMatch = content.match(legacyRegex);
      if (legacyMatch && typeof legacyMatch.index === 'number') {
        const trimmedContent = content.slice(0, legacyMatch.index).trimEnd();
        const value = legacyMatch[1].trim();
        return {
          content: trimmedContent,
          value: value.length > 0 ? value : undefined,
          found: true,
        };
      }
      return { content, found: false };
    }

      private processSelfReportedStance(
      content: string,
      discussion: RunConfig['discussion'],
    ): { content: string; stance?: { score: number; note?: string } } {
      const trimmed = content.trim();
        const ratingRegex = /(?:\(|（)\s*(?:立场|情感)[:：]\s*([+-]?\d+)\s*(?:\)|）)/i;
        const match = trimmed.match(ratingRegex);
      if (!match) {
        return { content: trimmed };
      }
      const size = normalizeScaleSize(discussion?.stanceScaleSize);
      const maxLevel = Math.floor(Math.max(3, size) / 2);
      let score = Number(match[1]);
      if (!Number.isFinite(score)) {
        return { content: trimmed };
      }
      score = Math.max(-maxLevel, Math.min(maxLevel, score));
        const positiveDesc = ensurePositiveViewpoint(discussion.positiveViewpoint);
        const negativeDesc = ensureNegativeViewpoint(discussion.negativeViewpoint);
      const note = score > 0 ? positiveDesc : score < 0 ? negativeDesc : '中立';
        const sanitizedContent = trimmed.replace(match[0], '').trim();
      const displayContent = sanitizedContent.length > 0 ? sanitizedContent : trimmed;
      return {
        content: displayContent,
        stance: {
          score,
          note,
        },
      };
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

  private appendMessageSnapshot(message: Message) {
    this.runIfCurrent(() => {
      this.appStore.getState().appendMessage(message);
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
