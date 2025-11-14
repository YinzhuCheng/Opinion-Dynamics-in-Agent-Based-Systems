import { nanoid } from 'nanoid';
import { buildAgentSystemPrompt, buildAgentUserPrompt } from './prompts';
import type { AgentSpec, Message, ModelConfig, RunConfig, RunStatus } from '../types';
import { useAppStore } from '../store/useAppStore';
import { chatStream } from '../utils/llmAdapter';
import type { ChatMessage } from '../utils/llmAdapter';

let activeRunner: ConversationRunner | undefined;

export const startConversation = async () => {
  if (activeRunner?.isRunning()) {
    activeRunner.requestStop();
  }
  const runner = new ConversationRunner();
  activeRunner = runner;
  try {
    await runner.run();
  } finally {
    if (activeRunner === runner) {
      activeRunner = undefined;
    }
  }
};

export const stopConversation = () => {
  activeRunner?.requestStop();
};

class ConversationRunner {
  private stopped = false;
  private readonly appStore = useAppStore;

  isRunning() {
    const { phase } = this.appStore.getState().runState.status;
    return phase === 'running' || phase === 'stopping';
  }

  requestStop() {
    this.stopped = true;
    this.appStore.getState().setStopRequested(true);
    this.appStore.getState().setRunStatus((status) => ({
      ...status,
      phase: status.phase === 'running' ? 'stopping' : status.phase,
      awaitingLabel: undefined,
    }));
  }

  async run() {
    const state = this.appStore.getState();
    const { runState } = state;
    const { agents, config } = runState;

    if (agents.length === 0) {
      this.appStore.getState().setRunStatus({
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

      const topic = config.discussion?.topic?.trim();
      if (!topic) {
        this.appStore.getState().setRunStatus({
          phase: 'error',
          mode: config.mode,
          error: '请先在配置页填写对话主题，所有 Agent 将围绕该主题展开。',
          currentRound: 0,
          currentTurn: 0,
          totalMessages: 0,
          summarizedCount: 0,
          startedAt: Date.now(),
          finishedAt: Date.now(),
        });
        return;
      }
      const positiveDefinition = config.discussion?.positiveDefinition?.trim();
      const negativeDefinition = config.discussion?.negativeDefinition?.trim();
      if (!positiveDefinition || !negativeDefinition) {
        this.appStore.getState().setRunStatus({
          phase: 'error',
          mode: config.mode,
          error: '请完善“正值代表 / 负值代表”的含义，方便模型给出对应立场。',
          currentRound: 0,
          currentTurn: 0,
          totalMessages: 0,
          summarizedCount: 0,
          startedAt: Date.now(),
          finishedAt: Date.now(),
        });
        return;
      }

    this.appStore.getState().resetMessages();
    this.appStore.getState().setStopRequested(false);
    this.stopped = false;

    const startedAt = Date.now();
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

    try {
      if (config.mode === 'round_robin') {
        await this.runRoundRobin(agents, config);
      } else {
        await this.runFreeDialogue(agents, config);
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

  private async runRoundRobin(agents: AgentSpec[], config: RunConfig) {
    const maxRounds = config.maxRounds ?? 3;
    for (let round = 1; round <= maxRounds; round += 1) {
      if (this.shouldStop()) break;
      for (let turn = 0; turn < agents.length; turn += 1) {
        if (this.shouldStop()) break;
        const agent = agents[turn];
        this.setStatus((status) => ({
          ...status,
          currentRound: round,
          currentTurn: turn + 1,
          lastAgentId: agent.id,
        }));
        await this.executeAgentTurn(agent, round, turn + 1, config);
      }
    }
  }

  private async runFreeDialogue(agents: AgentSpec[], config: RunConfig) {
    const maxMessages = config.maxMessages ?? 20;
    let producedMessages = 0;
    let round = 0;
    let consecutiveSkipRounds = 0;

    while (producedMessages < maxMessages && !this.shouldStop()) {
      round += 1;
      let skipsThisRound = 0;

      for (let turn = 0; turn < agents.length; turn += 1) {
        if (this.shouldStop() || producedMessages >= maxMessages) break;
        const agent = agents[turn];
        this.setStatus((status) => ({
          ...status,
          currentRound: round,
          currentTurn: turn + 1,
          lastAgentId: agent.id,
        }));
        const message = await this.executeAgentTurn(agent, round, turn + 1, config);
        if (message?.content === '__SKIP__') {
          skipsThisRound += 1;
        } else if (message) {
          producedMessages += 1;
        }
      }

      if (skipsThisRound === agents.length) {
        consecutiveSkipRounds += 1;
        if (consecutiveSkipRounds >= 2) {
          // all agents consistently skip, end early
          break;
        }
      } else {
        consecutiveSkipRounds = 0;
      }
    }
  }

    private async executeAgentTurn(agent: AgentSpec, round: number, turn: number, config: RunConfig) {
    const baseModelConfig = this.resolveModelConfig(agent, config);
    const apiKey = this.resolveApiKey(baseModelConfig);

    if (!apiKey) {
      throw new Error(`未找到 ${baseModelConfig.vendor} 的 API Key，请在配置页填写。`);
    }
    const modelConfig: ModelConfig = { ...baseModelConfig, apiKey };

      const contextMessages = this.collectDialogueContext(round, agent.id);
      this.appStore.getState().setVisibleWindow(contextMessages);
      const agentNames = this.getAgentNameMap();
      const trustWeights = this.buildTrustContext(agent.id);
      const discussion = this.appStore.getState().runState.config.discussion;

      const systemPrompt = buildAgentSystemPrompt({
        agent,
        mode: config.mode,
        round,
        turn,
        contextMessages,
        agentNames,
        trustWeights,
        topic: discussion.topic,
        stanceScaleSize: discussion.stanceScaleSize,
        positiveDefinition: discussion.positiveDefinition,
        negativeDefinition: discussion.negativeDefinition,
      });
      const userPrompt = buildAgentUserPrompt({
        agent,
        mode: config.mode,
        round,
        turn,
        contextMessages,
        agentNames,
        trustWeights,
        topic: discussion.topic,
        stanceScaleSize: discussion.stanceScaleSize,
        positiveDefinition: discussion.positiveDefinition,
        negativeDefinition: discussion.negativeDefinition,
      });

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const extra = {
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.max_output_tokens,
    };

    let content = '';
    try {
      content =
        (await chatStream(messages, modelConfig, extra, {
          onStatus: (status) => {
            if (status === 'waiting_response' || status === 'responding') {
              this.setAwaiting('response');
            } else if (status === 'thinking') {
              this.setAwaiting('thinking');
            } else if (status === 'done') {
              this.setAwaiting(undefined);
            }
          },
        })) || '';
    } finally {
      this.setAwaiting(undefined);
    }

    content = content.trim() || '__SKIP__';

      const stanceResult = this.processSelfReportedStance(content, discussion);
      content = stanceResult.content;

    const message: Message = {
      id: nanoid(),
      agentId: agent.id,
      role: 'assistant',
      content,
      ts: Date.now(),
      round,
      turn,
      systemPrompt,
      userPrompt,
    };
    if (stanceResult.stance) {
      message.stance = stanceResult.stance;
    }

    this.appStore.getState().appendMessage(message);
    this.updateStatusAfterMessage(message);

    return message;
  }

  private updateStatusAfterMessage(message: Message) {
    this.setStatus((status) => ({
      ...status,
      totalMessages: status.totalMessages + (message.content === '__SKIP__' ? 0 : 1),
    }));
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

    private collectDialogueContext(round: number, agentId: string): Message[] {
      const messages = this.appStore.getState().runState.messages;
      const context: Message[] = [];
      if (round > 1) {
        context.push(...messages.filter((message) => message.round === round - 1));
      }
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.round === round && lastMessage.agentId !== agentId) {
        context.push(lastMessage);
      }
      return context;
    }

    private processSelfReportedStance(
      content: string,
      discussion: RunConfig['discussion'],
    ): { content: string; stance?: { score: number; note?: string } } {
      const trimmed = content.trim();
      const ratingRegex = /(?:\(|（)\s*情感[:：]\s*([+-]?\d+)\s*(?:\)|）)\s*$/;
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
      const positiveDesc = discussion.positiveDefinition?.trim() || '倾向正向立场';
      const negativeDesc = discussion.negativeDefinition?.trim() || '倾向负向立场';
      const note = score > 0 ? positiveDesc : score < 0 ? negativeDesc : '中立';
      const sanitizedContent = trimmed.slice(0, trimmed.length - match[0].length).trimEnd();
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
    this.appStore.getState().setRunStatus(updater);
  }

  private setAwaiting(label?: 'response' | 'thinking') {
    this.setStatus((status) => ({
      ...status,
      awaitingLabel: label,
    }));
  }

  private shouldStop() {
    return this.stopped || this.appStore.getState().runState.stopRequested;
  }

  private captureResultSnapshot() {
    const state = this.appStore.getState().runState;
    const status = state.status;
    this.appStore.getState().setResult({
      messages: state.messages,
      finishedAt: status.finishedAt ?? Date.now(),
      summary: state.summary,
      configSnapshot: state.config,
      status,
    });
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
