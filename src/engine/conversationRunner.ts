import { nanoid } from 'nanoid';
import {
  buildAgentSystemPrompt,
  buildAgentUserPrompt,
  buildSentimentPrompt,
  buildStancePrompt,
  buildSummarizationPrompt,
} from './prompts';
import { resolveSentimentLabels } from './sentiment';
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
    const store = this.appStore.getState();
    const { runState } = store;
    const baseModelConfig = this.resolveModelConfig(agent, config);
    const apiKey = this.resolveApiKey(baseModelConfig);

    if (!apiKey) {
      throw new Error(`未找到 ${baseModelConfig.vendor} 的 API Key，请在配置页填写。`);
    }
    const modelConfig: ModelConfig = { ...baseModelConfig, apiKey };

    const systemPrompt = buildAgentSystemPrompt({
      agent,
      summary: runState.summary,
      visibleWindow: runState.visibleWindow,
      mode: config.mode,
      round,
      turn,
    });
    const userPrompt = buildAgentUserPrompt({
      agent,
      summary: runState.summary,
      visibleWindow: runState.visibleWindow,
      mode: config.mode,
      round,
      turn,
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];
    const extra = {
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.max_output_tokens,
      topP: modelConfig.top_p,
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

    const message: Message = {
      id: nanoid(),
      agentId: agent.id,
      role: 'assistant',
      content,
      ts: Date.now(),
    };

    this.appStore.getState().appendMessage(message);
    this.updateVisibleWindow();
    this.updateStatusAfterMessage(message);

    await this.runClassificationPipelines(message, config);
    await this.maybeSummarizeMemory(config);

    return message;
  }

  private async runClassificationPipelines(message: Message, config: RunConfig) {
    if (message.content === '__SKIP__') {
      return;
    }
    const tasks: Promise<void>[] = [this.performSentiment(message, config)];
    if (config.visualization?.enableStanceChart) {
      tasks.push(this.performStanceScoring(message, config));
    }
    await Promise.all(tasks);
  }

  private async performSentiment(message: Message, config: RunConfig) {
    const sentimentSetting = config.sentiment;
    if (!sentimentSetting.enabled) return;

    const labels = resolveSentimentLabels(sentimentSetting);
    if (labels.length < 2) return;

    const baseModelConfig = sentimentSetting.modelConfigOverride ?? this.resolveFallbackModelConfig(config);
    const apiKey = this.resolveApiKey(baseModelConfig);
    if (!apiKey) {
      console.warn('[Sentiment] 缺少情感分类模型的 API Key，跳过。');
      return;
    }
    const modelConfig: ModelConfig = { ...baseModelConfig, apiKey };

    try {
      const { system, user } = buildSentimentPrompt(labels);
      const result = await chatStream(
        [
          { role: 'system', content: system },
          { role: 'user', content: `${user}\n\n消息内容：${message.content}` },
        ],
        modelConfig,
        {
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.max_output_tokens,
          topP: modelConfig.top_p,
        },
      );
      const parsed = safeJsonParse(result);
      if (parsed?.label && labels.includes(parsed.label)) {
        this.appStore.getState().updateMessage(message.id, (msg) => {
          msg.sentiment = {
            label: parsed.label,
            confidence: typeof parsed.confidence === 'number' ? clamp(parsed.confidence, 0, 1) : undefined,
          };
        });
      }
    } catch (error) {
      console.warn('[Sentiment] 分类失败：', error);
    }
  }

  private async performStanceScoring(message: Message, config: RunConfig) {
    const baseModelConfig = this.resolveFallbackModelConfig(config);
    const apiKey = this.resolveApiKey(baseModelConfig);
    if (!apiKey) {
      console.warn('[Stance] 缺少模型 API Key，跳过立场评分。');
      return;
    }
    const modelConfig: ModelConfig = { ...baseModelConfig, apiKey };

    try {
      const { system, user } = buildStancePrompt();
      const result = await chatStream(
        [
          { role: 'system', content: system },
          { role: 'user', content: `${user}\n\n消息内容：${message.content}` },
        ],
        modelConfig,
        {
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.max_output_tokens,
          topP: modelConfig.top_p,
        },
      );
      const parsed = safeJsonParse(result);
      if (typeof parsed?.score === 'number') {
        this.appStore.getState().updateMessage(message.id, (msg) => {
          msg.stance = {
            score: clamp(parsed.score, -1, 1),
            note: typeof parsed.note === 'string' ? parsed.note : undefined,
          };
        });
      }
    } catch (error) {
      console.warn('[Stance] 立场评分失败：', error);
    }
  }

  private async maybeSummarizeMemory(config: RunConfig) {
    const { summarization, slidingWindow } = config.memory;
    const { runState } = this.appStore.getState();
    const { messages, status } = runState;

    if (!summarization.enabled) {
      if (runState.summary || status.summarizedCount !== 0) {
        this.appStore.getState().setSummary('');
        this.setStatus((current) => ({
          ...current,
          summarizedCount: 0,
        }));
      }
      return;
    }

    if (messages.length === 0) {
      return;
    }

    const agentCount = Math.max(1, runState.agents.length);
    const windowKeep = slidingWindow.enabled ? this.getWindowMessageCount(config, agentCount) : 0;
    const cutoffIndex = slidingWindow.enabled ? Math.max(0, messages.length - windowKeep) : messages.length;
    const alreadySummarized = status.summarizedCount;

    if (cutoffIndex <= alreadySummarized) {
      return;
    }

    const pending = messages.slice(alreadySummarized, cutoffIndex);
    const requiredMessages = this.getSummarizationIntervalMessages(config, agentCount);

    if (pending.length < requiredMessages) {
      return;
    }

    const transcripts = pending
      .map((msg) => formatMessageForTranscript(msg, this.resolveAgentName(msg.agentId)))
      .join('\n');

    const baseModelConfig = this.resolveFallbackModelConfig(config);
    const apiKey = this.resolveApiKey(baseModelConfig);
    if (!apiKey) {
      console.warn('[Summary] 缺少模型 API Key，跳过摘要压缩。');
      return;
    }
    const modelConfig: ModelConfig = { ...baseModelConfig, apiKey };

    try {
      const { system, user } = buildSummarizationPrompt(runState.summary, transcripts);
      const result = await chatStream(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        modelConfig,
        {
          temperature: modelConfig.temperature,
          maxTokens: summarization.maxSummaryTokens,
          topP: modelConfig.top_p,
        },
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
      );
      if (result) {
        this.appStore.getState().setSummary(result.trim());
        this.setStatus((state) => ({
          ...state,
          summarizedCount: state.summarizedCount + pending.length,
        }));
        this.updateVisibleWindow();
      }
    } catch (error) {
      console.warn('[Summary] 摘要生成失败：', error);
    } finally {
      this.setAwaiting(undefined);
    }
  }

  private updateVisibleWindow() {
    const { config, messages, agents } = this.appStore.getState().runState;
    const sliding = config.memory.slidingWindow;
    if (!sliding.enabled) {
      this.appStore.getState().setVisibleWindow(messages);
      return;
    }
    const agentCount = Math.max(1, agents.length);
    const windowMessages = this.getWindowMessageCount(config, agentCount);
    if (windowMessages >= messages.length) {
      this.appStore.getState().setVisibleWindow(messages);
      return;
    }
    const start = Math.max(0, messages.length - windowMessages);
    this.appStore.getState().setVisibleWindow(messages.slice(start));
  }

  private updateStatusAfterMessage(message: Message) {
    this.setStatus((status) => ({
      ...status,
      totalMessages: status.totalMessages + (message.content === '__SKIP__' ? 0 : 1),
    }));
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

  private resolveFallbackModelConfig(config: RunConfig): ModelConfig {
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

  private resolveAgentName(agentId: string): string {
    const store = this.appStore.getState();
    const agent = store.runState.agents.find((a) => a.id === agentId);
    return agent ? agent.name : agentId;
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

  private getWindowMessageCount(config: RunConfig, agentCount: number): number {
    const rounds = Math.max(1, Math.floor(config.memory.slidingWindow.windowRounds));
    if (config.mode === 'round_robin') {
      return rounds * Math.max(1, agentCount);
    }
    return rounds;
  }

  private getSummarizationIntervalMessages(config: RunConfig, agentCount: number): number {
    const rounds = Math.max(1, Math.floor(config.memory.summarization.intervalRounds));
    if (config.mode === 'round_robin') {
      return rounds * Math.max(1, agentCount);
    }
    return rounds;
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

const formatMessageForTranscript = (message: Message, agentName: string): string => {
  const sentiment = message.sentiment ? `（情感：${message.sentiment.label}${formatConfidence(message.sentiment.confidence)}）` : '';
  const stance =
    typeof message.stance?.score === 'number'
      ? `（立场：${message.stance.score.toFixed(2)}${message.stance.note ? `，${message.stance.note}` : ''}）`
      : '';
  const meta = [sentiment, stance].filter(Boolean).join(' ');
  return `${agentName}: ${message.content}${meta ? ` ${meta}` : ''}`;
};

const formatConfidence = (confidence?: number) => {
  if (typeof confidence !== 'number') return '';
  return `，置信度 ${confidence.toFixed(2)}`;
};

const safeJsonParse = (content: string): any => {
  try {
    const trimmed = content.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(max, Math.max(min, value));
};

const defaultFallbackModel = (): ModelConfig => ({
  vendor: 'openai',
  baseUrl: '',
  apiKey: '',
  model: 'gpt-4.1-mini',
  temperature: 0.7,
  top_p: 0.95,
});
