import { describePersona } from './persona';
import type { AgentSpec, DialogueMode, Message } from '../types';

interface AgentPromptOptions {
  agent: AgentSpec;
  summary: string;
  visibleWindow: Message[];
  mode: DialogueMode;
  round: number;
  turn: number;
}

export const buildAgentSystemPrompt = ({
  agent,
  summary,
  mode,
}: AgentPromptOptions): string => {
  const personaDescription = describePersona(agent.persona);
  const summarySection = summary
    ? `历史摘要（供参考，可在回答中引用要点）：
${summary}`
    : '历史摘要：暂无摘要或无需引用。';

  const skipInstruction =
    mode === 'free'
      ? '若判断本轮没有新的观点或信息，请输出 "__SKIP__" 表示跳过发言。'
      : '必须在每一轮给出观点与理由，可基于已有讨论提出补充或质询。';

  return [
    `你是一名多 Agent 观点演化系统中的参与者，请始终保持角色画像与沟通风格的一致性，并遵循下列规则：`,
    personaDescription,
    summarySection,
    `核心职责：
- 在轮到你发言时，根据角色视角提出观点、论据或对他人观点的回应。
- 与其他 Agent 协作或辩论，推动讨论朝目标收敛。
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
  visibleWindow,
  mode,
  round,
  turn,
}: AgentPromptOptions & { visibleWindow: Message[] }): string => {
  const dialogueTranscripts = visibleWindow.length
    ? visibleWindow
        .map((message) => {
          const content = message.content === '__SKIP__' ? '(跳过本轮)' : message.content;
          return `${message.agentId}: ${content}`;
        })
        .join('\n')
    : '尚无对话历史，这可能是首轮发言。';

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
    `最近可见对话：\n${dialogueTranscripts}`,
    '请基于以上内容给出你的回应（或跳过）。',
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
