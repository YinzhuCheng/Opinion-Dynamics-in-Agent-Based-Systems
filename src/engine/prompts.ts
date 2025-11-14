import { describePersona } from './persona';
import type { AgentSpec, DialogueMode } from '../types';

export interface TrustEntry {
  agentName: string;
  weight: number;
}

export interface BatchTranscript {
  agentName: string;
  content: string;
}

interface AgentPromptOptions {
  agent: AgentSpec;
  mode: DialogueMode;
  round: number;
  turn: number;
  previousBatchLabel: string;
  previousBatch: BatchTranscript[];
  trustEntries: TrustEntry[];
}

const formatTrustEntries = (entries: TrustEntry[]): string => {
  if (!entries.length) {
    return '信任度参考：尚未设置，默认等权参考所有人。';
  }
  const lines = entries.map(
    (entry) => `- ${entry.agentName}: ${entry.weight.toFixed(2).replace(/\.?0+$/, '')}`,
  );
  return [
    '信任度参考（当前行表示你采纳上一批观点时的权重，建议相加≈1）：',
    ...lines,
  ].join('\n');
};

export const buildAgentSystemPrompt = ({
  agent,
  mode,
  trustEntries,
}: AgentPromptOptions): string => {
  const personaDescription = describePersona(agent.persona);
  const skipInstruction =
    mode === 'free'
      ? '若判断本轮没有新的观点或信息，请输出 "__SKIP__" 表示跳过发言。'
      : '必须在每一轮给出观点与理由，可基于已有讨论提出补充或质询。';

  return [
    `你是一名多 Agent 观点演化系统中的参与者，请始终保持角色画像与沟通风格的一致性，并遵循下列规则：`,
    personaDescription,
    formatTrustEntries(trustEntries),
    `核心职责：
- 在轮到你发言时，根据角色视角提出观点、论据或对他人观点的回应。
- 参考上一批讨论结果，并按照信任度权重吸收他人观点（DeGroot 模型思想）。
- 保持条理清晰、专业且尊重的表达方式。
- 如需引用数据或假设，请明确指出来源或不确定性。`,
    `输出要求：
- 使用简洁段落阐述论点，可包含条列说明。
- 不要以 JSON 或代码格式输出。
- ${skipInstruction}
- 如需提出后续行动建议或结论，请在末尾表达。`,
  ].join('\n\n');
};

export const buildAgentUserPrompt = ({
  agent,
  mode,
  round,
  turn,
  previousBatch,
  previousBatchLabel,
}: AgentPromptOptions): string => {
  const dialogueTranscripts = previousBatch.length
    ? previousBatch
        .map((message) => {
          const content = message.content === '__SKIP__' ? '(上一批选择跳过)' : message.content;
          return `${message.agentName}: ${content}`;
        })
        .join('\n')
    : '上一批尚无对话，请以初始观点为主。';

  const modeHint =
    mode === 'round_robin'
      ? '当前为轮询模式，请确保本轮提供有效观点或对已有观点的回应。'
      : '当前为自由对话模式，你可根据判断选择发言或跳过。';

  const initialOpinionHint = agent.initialOpinion
    ? `该角色的初始观点：${agent.initialOpinion}`
    : '若你尚未明确立场，请在本轮给出立场与理由。';

  return [
    `轮次信息：第 ${round} 轮，第 ${turn} 个发言者。`,
    modeHint,
    initialOpinionHint,
    `上一批讨论（${previousBatchLabel}）：\n${dialogueTranscripts}`,
    '请依据信任度权重综合上一批观点，给出你的新一轮发言（或 "__SKIP__" 表示跳过）。',
  ].join('\n\n');
};

export const buildSentimentPrompt = (labels: string[]): { system: string; user: string } => {
  const labelList = labels.map((label) => `"${label}"`).join(', ');
  const system = `你是一名情感分类助手，请阅读用户提供的一段文本，并返回其中最符合的情感标签及置信度（0-1 之间的小数）。标签候选为：[${labelList}]。输出必须为 JSON 对象，格式：{"label":"标签","confidence":0.xx}，不做额外说明。`;
  return {
    system,
    user: '请对上述消息文本进行情感分类。',
  };
};

export const buildStancePrompt = (): { system: string; user: string } => {
  const system =
    '你是一名观点立场分析员，请阅读消息内容，输出其在议题上的立场强度，范围为 -1 到 +1（-1 表示完全反对，+1 表示坚决支持，0 表示中立或未表态）。请输出 JSON，格式：{"score":0.xx,"note":"简要说明"}。';
  return {
    system,
    user: '请评估这段文本的立场强度并给出简要理由。',
  };
};

export const buildSummarizationPrompt = (
  existingSummary: string,
  chunkTranscripts: string,
): { system: string; user: string } => {
  const system = `你是一名对话总结助手，请在保留关键信息的前提下，用简洁条列或段落更新对话摘要。若已有摘要，请合并新的对话要点。输出应为简洁的中文段落或项目符号列表。`;
  const user = [
    existingSummary ? `【现有摘要】：\n${existingSummary}` : '【现有摘要】：暂无',
    `【新增对话】：\n${chunkTranscripts}`,
    '请更新完整摘要。',
  ].join('\n\n');
  return { system, user };
};
