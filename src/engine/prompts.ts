import { describePersona } from './persona';
import type { AgentSpec, DialogueMode, Message } from '../types';

interface AgentPromptOptions {
  agent: AgentSpec;
  mode: DialogueMode;
  round: number;
  turn: number;
  previousBatch: Message[];
  agentNames: Record<string, string>;
  trustWeights: Array<{ agentName: string; weight: number }>;
}

export const buildAgentSystemPrompt = ({
  agent,
  mode,
  trustWeights,
}: AgentPromptOptions): string => {
  const personaDescription = describePersona(agent.persona);
  const trustSection =
    trustWeights.length > 0
      ? `信任度矩阵（上一批次发言的参考权重，符合 DeGroot 聚合思路）：
${trustWeights.map((item) => `- ${item.agentName}: ${item.weight.toFixed(2)}`).join('\n')}
权重越大代表越信任，回答时优先回应权重高的对象。`
      : '信任度矩阵：未提供特定偏好，可均匀参考所有 Agent 的上一批次发言。';

  const skipInstruction =
    mode === 'free'
      ? '若判断本轮没有新的观点或信息，请输出 "__SKIP__" 表示跳过发言。'
      : '必须在每一轮给出观点与理由，可基于已有讨论提出补充或质询。';

  return [
    `你是一名多 Agent 观点演化系统中的参与者，请始终保持角色画像与沟通风格的一致性，并遵循下列规则：`,
    personaDescription,
    trustSection,
    `核心职责：
- 在轮到你发言时，根据角色视角提出观点、论据或对他人观点的回应。
- 与其他 Agent 协作或辩论，推动讨论朝目标收敛。
- 保持条理清晰、专业且尊重的表达方式。
- 如需引用数据或假设，请明确说明来源或不确定性。`,
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
  agentNames,
}: AgentPromptOptions): string => {
  const dialogueTranscripts = previousBatch.length
    ? previousBatch
        .map((message) => {
          const content = message.content === '__SKIP__' ? '(跳过本轮)' : message.content;
          const speaker = agentNames[message.agentId] ?? message.agentId;
          return `${speaker}: ${content}`;
        })
        .join('\n')
    : '上一批次暂无对话，这可能是首轮发言。';

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
    `上一批次对话（仅供参考）：\n${dialogueTranscripts}`,
    '请仅基于上一批次讨论与信任度矩阵给出回应（或跳过），无需回顾更早轮次。',
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

