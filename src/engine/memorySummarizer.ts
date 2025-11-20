import { chatStream } from '../utils/llmAdapter';
import type {
  AgentMemorySnapshot,
  AgentSpec,
  Message,
  ModelConfig,
} from '../types';

interface MemorySummarizerOptions {
  agent: AgentSpec;
  round: number;
  windowSize: number;
  messages: Message[];
  agentNames: Record<string, string>;
  modelConfig: ModelConfig;
}

const DEFAULT_SNAPSHOT: AgentMemorySnapshot = { personal: [], peers: [] };

export async function summarizeAgentMemory({
  agent,
  round,
  windowSize,
  messages,
  agentNames,
  modelConfig,
}: MemorySummarizerOptions): Promise<AgentMemorySnapshot> {
  if (windowSize <= 0 || messages.length === 0) {
    return DEFAULT_SNAPSHOT;
  }

  const conversationDigest = buildConversationDigest(messages, agentNames);
  const userPrompt = [
    `目标角色：${agent.name}`,
    `记忆窗口长度：${windowSize}`,
    `需要覆盖的轮次范围：第 ${Math.min(...messages.map((m) => m.round))} - 第 ${round} 轮`,
    '',
    '请总结下方对话（按轮次排序）：',
    conversationDigest,
  ].join('\n');

  const systemPrompt = [
    '你是多智能体系统的“发言摘要”整理助手，用于帮助角色快速回顾最近几轮的发言要点。',
    '必须输出一个 JSON 对象，结构如下：',
    `{"personal":[{"round":1,"text":"..."}],"peers":[{"round":1,"agent":"A2","text":"..."}]}`,
    '规则：',
    `- personal 字段列出该角色最近的发言摘要，最多 ${windowSize} 条，轮次越新越靠后。`,
    `- peers 字段列出其他角色的关键触发点，同样最多 ${windowSize} 条，可包含不同角色，需注明 agent 名称。`,
    '- 每条文本使用简洁中文描述，突出观点或情绪变化，避免冗长复述原文。',
    '- 如果某类信息不足，可只返回实际数量；若完全没有，请返回空数组。',
    '- 只输出 JSON，不要添加多余解释。',
  ].join('\n');

  try {
    const response =
      (await chatStream(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        modelConfig,
        { temperature: 0.2, maxTokens: 512 },
      )) ?? '';
    return parseMemorySummary(response, windowSize) ?? fallbackSnapshot(messages, agent, agentNames, windowSize);
  } catch (error) {
    console.error('[memory] summarizeAgentMemory error', error);
    return fallbackSnapshot(messages, agent, agentNames, windowSize);
  }
}

const buildConversationDigest = (messages: Message[], agentNames: Record<string, string>) => {
  return [...messages]
    .sort((a, b) => (a.round !== b.round ? a.round - b.round : a.turn - b.turn))
    .map((message) => {
      const speaker = agentNames[message.agentId] ?? message.agentId;
      const stance =
        typeof message.stance?.score === 'number'
          ? `（立场：${formatStance(message.stance.score)}）`
          : '';
      const cleanContent = message.content.replace(/\s+/g, ' ').trim();
      return `第${message.round}轮 #${message.turn} ${speaker}: ${cleanContent}${stance}`;
    })
    .join('\n');
};

const parseMemorySummary = (raw: string, windowSize: number): AgentMemorySnapshot | undefined => {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return undefined;
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const personal = Array.isArray(parsed.personal)
        ? parsed.personal
            .map((item: any) => ({
              round: Number(item.round),
              text: typeof item.text === 'string' ? item.text.trim() : '',
            }))
            .filter(
              (item: { round: number; text: string }) =>
                Number.isFinite(item.round) && Boolean(item.text),
            )
        : [];
      const peers = Array.isArray(parsed.peers)
        ? parsed.peers
            .map((item: any) => ({
              round: Number(item.round),
              agentName: typeof item.agent === 'string' ? item.agent : '',
              text: typeof item.text === 'string' ? item.text.trim() : '',
            }))
            .filter(
              (item: { round: number; agentName: string; text: string }) =>
                Number.isFinite(item.round) && Boolean(item.agentName) && Boolean(item.text),
            )
        : [];
    return {
      personal: personal.slice(-windowSize),
      peers: peers.slice(-windowSize),
    };
  } catch {
    return undefined;
  }
};

const fallbackSnapshot = (
  messages: Message[],
  agent: AgentSpec,
  agentNames: Record<string, string>,
  windowSize: number,
): AgentMemorySnapshot => {
  const sorted = [...messages].sort((a, b) => (a.round !== b.round ? a.round - b.round : a.turn - b.turn));
  const personal = sorted
    .filter((msg) => msg.agentId === agent.id)
    .slice(-windowSize)
    .map((msg) => ({
      round: msg.round,
      text: truncateText(msg.content, 120),
    }));
  const peers = sorted
    .filter((msg) => msg.agentId !== agent.id)
    .slice(-windowSize)
    .map((msg) => ({
      round: msg.round,
      agentName: agentNames[msg.agentId] ?? msg.agentId,
      text: truncateText(msg.content, 120),
    }));
  return { personal, peers };
};

const truncateText = (text: string, max = 160) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};

const formatStance = (value: number): string => (value > 0 ? `+${value}` : `${value}`);
