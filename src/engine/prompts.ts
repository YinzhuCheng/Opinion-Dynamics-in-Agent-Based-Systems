import { describePersona } from './persona';
import type { AgentSpec, DialogueMode, Message } from '../types';
import {
  ensureNegativeViewpoint,
  ensurePositiveViewpoint,
} from '../constants/discussion';

interface AgentPromptOptions {
  agent: AgentSpec;
  mode: DialogueMode;
  round: number;
  turn: number;
  contextMessages: Message[];
  agentNames: Record<string, string>;
  trustWeights: Array<{ agentName: string; weight: number }>;
  stanceScaleSize: number;
  positiveViewpoint: string;
  negativeViewpoint: string;
}

export const buildAgentSystemPrompt = ({
  agent,
  mode,
  trustWeights,
  stanceScaleSize,
  positiveViewpoint,
  negativeViewpoint,
}: AgentPromptOptions): string => {
  const personaDescription = describePersona(agent.persona);
  const trustSection =
    trustWeights.length > 0
      ? `信任度矩阵（上一批次发言的参考权重，符合 DeGroot 聚合思路）：
${trustWeights.map((item) => `- ${item.agentName}: ${item.weight.toFixed(2)}`).join('\n')}
权重越大代表越信任，回答时优先回应权重高的对象。`
      : '信任度矩阵：未提供特定偏好，可均匀参考所有 Agent 的上一批次发言。';
  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const scaleValues = buildScaleValues(stanceScaleSize);
  const positiveDesc = ensurePositiveViewpoint(positiveViewpoint);
  const negativeDesc = ensureNegativeViewpoint(negativeViewpoint);
  const stanceLine = `当前仅讨论一组对立立场：
- 正向：${positiveDesc}
- 负向：${negativeDesc}`;
  const ratingLine = `正文末尾必须紧跟“（情感：X）”，X 属于 [-${maxLevel}, +${maxLevel}] 的整数；绝对值越大代表越极端地支持正向或负向立场，0 表示完全中立。不得另起一句解释评分。`;
  const coverageHint = `刻度示例：${scaleValues.join(' / ')}。负值对应“${negativeDesc}”，正值对应“${positiveDesc}”。多轮对话中请主动探索不同强度，而不是永远停在单一取值。`;
  const continuityGuidelines = `对话策略：
- 参考上一批次的整体氛围构建“潜台词”，但在正文里以口语化方式继续讨论，不要频繁提“上一轮/上一批次”。
- 大部分情况下请顺着上一位发言者的视角继续推进；仅在确有必要时（小概率）开启新的细节或话题，且要解释衔接。
- 引用他人时只提名字，点到为止。`;
  const psychologyGuidelines = `心理模型机制：
- 将上一批次所有 Agent 的观点综合成一句“内心旁白”，描述你的心理状态（情绪、怀疑或坚持理由）。
- 你的发言由“该心理状态 + 上一位发言者”共同驱动。
- 输出顺序：正文 → （情感：X） → [[PSY]]隐含块。隐含块格式固定为 [[PSY]]你的心理状态[[/PSY]]，用 1-2 句话说明内心感受与成因，且不可在正文里提到“心理模型”或方括号。
- 该心理描述只用于系统内部记录，请确保它不会泄露在正文里。`;
  const naturalGuidelines = [
    '像即时聊天一样说话，可包含停顿、语气词或自我修正。',
    '使用“我/我们/你”来指代角色，不要说“根据 A1 的观点”“在本轮”等元叙述。',
    '避免模板化句式或编号，拆成两三句短句更自然。',
    '不要在输出里提到“信任度矩阵”“情感评分”等内部术语。',
  ].join('\n- ');

  const skipInstruction =
    mode === 'free'
      ? '若判断本轮没有新的观点或信息，请输出 "__SKIP__" 表示跳过发言。'
      : '必须在每一轮给出观点与理由，可基于已有讨论提出补充或质询。';

  return [
    `你是一名多 Agent 观点演化系统中的参与者，请始终保持角色画像与沟通风格的一致性，并遵循下列规则：`,
    personaDescription,
    trustSection,
    stanceLine,
    `核心职责：
- 在轮到你发言时，根据角色视角提出观点、论据或对他人观点的回应。
- 与其他 Agent 协作或辩论，推动讨论朝目标收敛。
- 保持条理清晰、专业且尊重的表达方式。
- 如需引用数据或假设，请明确说明来源或不确定性。`,
    continuityGuidelines,
    psychologyGuidelines,
    `输出要求：
- 使用简洁段落阐述论点，可包含条列说明。
- 不要以 JSON 或代码格式输出。
- ${skipInstruction}
- 如需提出后续行动建议或结论，请在末尾表达。
- ${ratingLine}
- ${coverageHint}

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
  stanceScaleSize,
  positiveViewpoint,
  negativeViewpoint,
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
  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const scaleValues = buildScaleValues(stanceScaleSize);
  const positiveDesc = ensurePositiveViewpoint(positiveViewpoint);
  const negativeDesc = ensureNegativeViewpoint(negativeViewpoint);
  const viewpointHint = `仅需在这两种立场之间展开拉扯：正向 = ${positiveDesc} ｜ 负向 = ${negativeDesc}。`;
  const ratingHint = `回答末尾必须添加“（情感：X）”，其中 X 属于 [-${maxLevel}, +${maxLevel}] 的整数，且绝对值越大表示越极端：负值 = ${negativeDesc}，正值 = ${positiveDesc}，0 = 中立。多轮对话中请尝试覆盖 ${scaleValues.join(' / ')} 等不同取值。`;
  const followHint =
    '优先承接上一位发言者的情绪或论点继续推进，只有在能自然衔接时才开启新的话题。上一批次的内容更多是潜在影响，正文里不要频繁提“上一轮”。';
  const styleHint =
    '保持口语化表达，不要说“在本轮”“根据 A1 的观点”，也不要列条目；像真人聊天那样，自然回应刚刚的发言，可包含感叹、犹豫或补充。';
  const psychologyHint =
    '输出格式：正文 + （情感：X） + [[PSY]]隐含块。隐含块仅用 1~2 句话描述你的心理状态与成因，且不得在正文中解释。';

  return [
    `轮次信息：第 ${round} 轮，第 ${turn} 个发言者。`,
    modeHint,
    initialOpinionHint,
    viewpointHint,
    `上一批次对话 + 上一位发言者内容（仅供参考）：\n${dialogueTranscripts}`,
    followHint,
    styleHint,
    ratingHint,
    psychologyHint,
  ].join('\n\n');
};

const buildScaleValues = (size: number): number[] => {
  const normalized = size % 2 === 0 ? size + 1 : size;
  const half = Math.max(1, Math.floor(normalized / 2));
  const values: number[] = [];
  for (let i = -half; i <= half; i += 1) {
    values.push(i);
  }
  return values;
};

