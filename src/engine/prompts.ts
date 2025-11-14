import { describePersona } from './persona';
import type { AgentSpec, DialogueMode, Message } from '../types';

interface AgentPromptOptions {
  agent: AgentSpec;
  mode: DialogueMode;
  round: number;
  turn: number;
  contextMessages: Message[];
  agentNames: Record<string, string>;
  trustWeights: Array<{ agentName: string; weight: number }>;
  topic: string;
  stanceScaleSize: number;
}

export const buildAgentSystemPrompt = ({
  agent,
  mode,
  trustWeights,
  topic,
  stanceScaleSize,
}: AgentPromptOptions): string => {
  const personaDescription = describePersona(agent.persona);
  const trustSection =
    trustWeights.length > 0
      ? `信任度矩阵（上一批次发言的参考权重，符合 DeGroot 聚合思路）：
${trustWeights.map((item) => `- ${item.agentName}: ${item.weight.toFixed(2)}`).join('\n')}
权重越大代表越信任，回答时优先回应权重高的对象。`
      : '信任度矩阵：未提供特定偏好，可均匀参考所有 Agent 的上一批次发言。';
  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const topicLine = topic ? `固定议题：${topic}` : '固定议题：请围绕用户设定的话题展开。';
  const ratingLine = `请在正文结束后紧跟一个括号标注情绪取向，例如（情感：+1），其中分值必须是 [-${maxLevel}, +${maxLevel}] 之间的整数。不要在正文里解释评分，也不要把它写成独立句。`;
  const naturalGuidelines = [
    '像即时聊天一样说话，语气可以轻松，有停顿、语气词或自我修正。',
    '始终用“我/我们/你”来指代自己和他人，不要说“根据 A1 的观点”这类第三人称，也不要提“轮次”“当前回合”。',
    '避免使用条列式编号、模板化句式或“综合来看”这类书面语，可拆成两三句短句。',
    '引用他人时只提名字（例如“我同意小王”），点到为止即可。',
    '不要在输出里提到“信任度矩阵”“情感评分”这些任务术语。',
  ].join('\n- ');

  const skipInstruction =
    mode === 'free'
      ? '若判断本轮没有新的观点或信息，请输出 "__SKIP__" 表示跳过发言。'
      : '必须在每一轮给出观点与理由，可基于已有讨论提出补充或质询。';

  return [
    `你是一名多 Agent 观点演化系统中的参与者，请始终保持角色画像与沟通风格的一致性，并遵循下列规则：`,
    personaDescription,
    trustSection,
    topicLine,
    `核心职责：
- 在轮到你发言时，根据角色视角提出观点、论据或对他人观点的回应。
- 与其他 Agent 协作或辩论，推动讨论朝目标收敛。
- 保持条理清晰、专业且尊重的表达方式。
- 如需引用数据或假设，请明确说明来源或不确定性。`,
      `输出要求：
- 使用简洁段落阐述论点，可包含条列说明。
- 不要以 JSON 或代码格式输出。
- ${skipInstruction}
- 如需提出后续行动建议或结论，请在末尾表达。
- ${ratingLine}

日常表达提示：
- ${naturalGuidelines}`,
  ].join('\n\n');
};

export const buildAgentUserPrompt = ({
  agent,
  mode,
  round,
  turn,
  contextMessages,
  agentNames,
  topic,
  stanceScaleSize,
}: AgentPromptOptions): string => {
  const dialogueTranscripts = contextMessages.length
    ? contextMessages
        .map((message) => {
          const content = message.content === '__SKIP__' ? '(跳过本轮)' : message.content;
          const speaker = agentNames[message.agentId] ?? message.agentId;
          return `${speaker}: ${content}`;
        })
        .join('\n')
    : '上一批次暂无对话（可能是首轮或你是该轮首个发言者）。';

  const modeHint =
    mode === 'round_robin'
      ? '当前为轮询模式，请确保本轮提供有效观点或对已有观点的回应。'
      : '当前为自由对话模式，你可根据判断选择发言或跳过。';

  const initialOpinionHint = agent.initialOpinion
    ? `该角色的初始观点：${agent.initialOpinion}`
    : '若你尚未明确立场，请在本轮给出立场与理由。';
  const topicHint = topic ? `固定议题：${topic}` : '请围绕用户提供的唯一议题展开。';
  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const ratingHint = `请在回答末尾添加“情感评分：X”，其中 X 属于 [-${maxLevel}, +${maxLevel}] 的整数（负值更负面，正值更正面，0 表示中立）。`;
  const styleHint =
    '保持口语化表达，不要说“在本轮”“根据 A1 的观点”，也不要列条目；像真人聊天那样，自然回应刚刚的发言，可包含感叹、犹豫或补充。';

  return [
    `轮次信息：第 ${round} 轮，第 ${turn} 个发言者。`,
    modeHint,
    initialOpinionHint,
    topicHint,
    `上一批次对话 + 上一位发言者内容（仅供参考）：\n${dialogueTranscripts}`,
    '请仅基于上一批次讨论、上一个发言者内容给出回应（或跳过），无需回顾更早轮次，不要提到“信任度矩阵”这类内部术语。',
    styleHint,
    ratingHint,
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

