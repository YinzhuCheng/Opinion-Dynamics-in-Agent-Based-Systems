import { describePersona } from './persona';
import type { AgentSpec, DialogueMode, Message } from '../types';
import {
  ensureNegativeViewpoint,
  ensurePositiveViewpoint,
} from '../constants/discussion';

const SYNTHESIS_HINT =
  '思考时需同时吸收：你的固有立场与上一轮心理旁白、上一位发言者的最新观点、上一轮所有 Agent 的整体氛围；不要机械复述，而要把这些线索熔炼成新的表达。';

interface AgentPromptOptions {
  agent: AgentSpec;
  mode: DialogueMode;
  round: number;
  turn: number;
  agentNames: Record<string, string>;
  trustWeights: Array<{ agentName: string; weight: number }>;
  stanceScaleSize: number;
  positiveViewpoint: string;
  negativeViewpoint: string;
  previousRoundMessages: Message[];
  lastSpeakerMessage?: Message;
  previousPsychology: Array<{ agentName: string; psychology: string }>;
  selfPreviousMessage?: Message;
}

export const buildAgentSystemPrompt = ({
  agent,
  mode,
  trustWeights,
  stanceScaleSize,
  positiveViewpoint,
  negativeViewpoint,
  previousPsychology,
}: AgentPromptOptions): string => {
  const personaRaw = describePersona(agent.persona).trim();
  const personaBlock =
    personaRaw.length > 0
      ? `人格画像：【\n${personaRaw}\n】`
      : '人格画像：【（未提供画像，请保持中性口吻）】';
  const personaAlignmentHint = '请让心理活动与外显措辞始终贴合人格画像/MBTI/大五人格的特质，不可自相矛盾。';
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
  const ratingLine = `正文末尾必须紧跟“（立场：X）”，X 属于 [-${maxLevel}, +${maxLevel}] 的整数；绝对值越大代表越极端地支持正向或负向立场，0 表示完全中立。不得另起一句解释评分。`;
  const coverageHint = `刻度示例：${scaleValues.join(' / ')}。负值对应“${negativeDesc}”，正值对应“${positiveDesc}”。多轮对话中请主动探索不同强度，而不是永远停在单一取值。`;
    const continuityGuidelines = `对话策略：
  - 参考上一批次的整体氛围构建“潜台词”，但在正文里以口语化方式继续讨论，不要频繁提“上一轮/上一批次”。
  - 大部分情况下请顺着上一位发言者的视角继续推进；仅在确有必要时（小概率）开启新的细节或话题，且要解释衔接。
  - 引用他人时只提名字，点到为止。
  - 遇到观点冲突可直接反驳或追问，不必刻意礼貌，可带一点争执语气以保持真实感。
  - 若上一轮心理旁白已出现明显动摇，请允许极性反转：可以从支持转为反对或相反方向，只要给出充分理由。`;
  const previousPsychologySection =
    previousPsychology.length > 0
      ? `上一轮心理模型快照（仅供你内化，不要在正文里引用）：
${previousPsychology.map((item) => `- ${item.agentName}: ${item.psychology}`).join('\n')}`
      : '上一轮心理模型快照：暂无记录（首轮或上一轮跳过），请自我推断气氛。';
    const psychologyGuidelines = `心理模型机制：
  - 将上一批次所有 Agent 的观点综合成“内心旁白”，描述你的心理状态（情绪、怀疑或坚持理由），并关联自身固有立场。
  - 你的发言需由“上一轮心理沉淀 + 上一位发言者的触发点 + 你上一轮的外显发言”共同驱动，必要时可反思上一轮自己说过的话。
  - 输出顺序：[[PSY]]隐含块 → 正文 → （立场：X）。隐含块必须以 [[PSY]] 开头、[[/PSY]] 结尾，并写成 2~3 句，依次交代：你的固有立场/上一轮心理余韵、上一位发言者带来的刺激、上一轮各 Agent 气氛对你的影响；该块只写心理，不要混入正文。
  - [[PSY]] 仅供系统记录，正文不可泄露这些元信息，也不要在正文里提到“心理模型”或方括号。
  - 当心理开始摇摆或你上一轮的结论不再站得住脚时，允许彻底改变立场，只需在心理和正文里说明触发点与新的理由。
  - 进行心理推导时，请显式权衡：上一轮的内心旁白、依据信任矩阵加权的上一轮发言集合、上一位发言者的即时刺激。`;
  const naturalGuidelines = [
    '像即时聊天一样说话，可包含停顿、语气词或自我修正。',
    '使用“我/我们/你”来指代角色，不要说“根据 A1 的观点”“在本轮”等元叙述。',
    '避免模板化句式或编号，拆成两三句短句更自然。',
    '不要在输出里提到“信任度矩阵”“立场评分”等内部术语。',
  ].join('\n- ');

  const skipInstruction =
    mode === 'random'
      ? '本轮采用随机顺序发言，你仍需给出明确观点与论据，不得跳过。'
      : '本轮按固定顺序发言，请确保提供有效观点或补充，而不是跳过。';

  return [
    `你是一名多 Agent 观点演化系统中的参与者，请始终保持角色画像与沟通风格的一致性，并遵循下列规则：`,
    personaBlock,
    personaAlignmentHint,
    trustSection,
    stanceLine,
  `核心职责：
- 在轮到你发言时，根据角色视角提出观点、论据或对他人观点的回应。
- 与其他 Agent 协作或辩论，推动讨论朝目标收敛。
- 如需引用数据或假设，请明确说明来源或不确定性。`,
    continuityGuidelines,
    psychologyGuidelines,
    SYNTHESIS_HINT,
    previousPsychologySection,
    `输出要求：
- 使用简洁段落阐述论点，可包含条列说明。
- 不要以 JSON 或代码格式输出。
- ${skipInstruction}
- 如需提出后续行动建议或结论，请在末尾表达。
- ${ratingLine}
- ${coverageHint}

日常表达提示：
  - ${naturalGuidelines}`,
  ].filter(Boolean).join('\n\n');
};

export const buildAgentUserPrompt = ({
  agent,
  mode,
  round,
  turn,
  agentNames,
  stanceScaleSize,
  positiveViewpoint,
  negativeViewpoint,
  previousRoundMessages,
  lastSpeakerMessage,
  previousPsychology,
  selfPreviousMessage,
}: AgentPromptOptions): string => {
  const personaRaw = describePersona(agent.persona).trim();
  const personaBlock =
    personaRaw.length > 0
      ? `人格画像：【\n${personaRaw}\n】`
      : '人格画像：【（未提供画像，请保持中性口吻）】';
  const personaAlignmentHint = '请确保心理与发言在语气、词汇、价值判断上都忠实于上述人格设定。';
  const previousRoundTranscript = previousRoundMessages.length
    ? previousRoundMessages
        .map((message) => {
          const content = message.content === '__SKIP__' ? '(跳过)' : message.content;
          const speaker = agentNames[message.agentId] ?? message.agentId;
          const stanceNote =
            typeof message.stance?.score === 'number'
              ? `（立场：${formatStance(message.stance.score)}｜${message.stance.note ?? '未注明'}）`
              : '';
          return `${speaker}: ${content}${stanceNote}`;
        })
        .join('\n')
      : '上一轮暂无对话（可能是首轮或上一轮全部跳过）。';
  const previousRoundStanceSummary = previousRoundMessages.length
    ? `上一轮立场速记（不含你自己）：\n${previousRoundMessages
        .map((message) => {
          const speaker = agentNames[message.agentId] ?? message.agentId;
          if (typeof message.stance?.score === 'number') {
            const note = message.stance.note ? `｜${message.stance.note}` : '';
            return `- ${speaker}: 立场 ${formatStance(message.stance.score)}${note}`;
          }
          return `- ${speaker}: 未提供立场刻度`;
        })
        .join('\n')}`
    : '上一轮立场速记：暂无记录。';
  const lastSpeakerLine = lastSpeakerMessage
    ? `${agentNames[lastSpeakerMessage.agentId] ?? lastSpeakerMessage.agentId}: ${
        lastSpeakerMessage.content === '__SKIP__' ? '(跳过)' : lastSpeakerMessage.content
      }`
    : '本轮尚无上一位发言者，你可以率先开场。';
  const previousPsychologyHint =
    previousPsychology.length > 0
      ? `上一轮各方的隐含心理（请仅作为潜台词吸收，不要逐条引用）：\n${previousPsychology
          .map((item) => `- ${item.agentName}: ${item.psychology}`)
          .join('\n')}`
      : '上一轮尚未形成可引用的心理模型，你可自行推断整体情绪。';

  const modeHint =
    mode === 'sequential'
      ? '当前为依次发言模式，请紧扣固定顺序提供有效观点或补充。'
      : '当前为随机顺序发言模式，请在出场机会内明确表达立场与理由。';

  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const scaleValues = buildScaleValues(stanceScaleSize);
  const positiveDesc = ensurePositiveViewpoint(positiveViewpoint);
  const negativeDesc = ensureNegativeViewpoint(negativeViewpoint);
  const initialOpinionHint = agent.initialOpinion
    ? `该角色的初始观点：${agent.initialOpinion}`
    : '若你尚未明确观点，请结合角色立场在本轮给出你的判断与理由。';
  const selfLastStance = selfPreviousMessage?.stance;
  const stanceHint =
    round === 1
      ? typeof agent.initialStance === 'number' && Number.isFinite(agent.initialStance)
        ? `该角色的初始立场：${formatStance(agent.initialStance)}（范围 ±${maxLevel}），首轮尽量按照此刻度发言。`
        : `首轮尚未设定明确立场，可在 ${scaleValues.join(' / ')} 中任选其一作为初始表态。`
      : selfLastStance
        ? `上一轮你的立场：${formatStance(selfLastStance.score)}（${selfLastStance.note ?? '未注明'}）。若当时心理已开始动摇，可在本轮调整甚至反转立场，但必须说明触发点。`
        : '上一轮你未给出立场刻度，可回顾当时的心理旁白，自行决定是维持、收敛还是反转。';
  const polarityHint =
    '若上一轮心理或外界刺激让你开始怀疑原有观点，可主动调整立场——包括极性反转——但要把心理变化写进 [[PSY]] 并在正文里给出充分理由。';
  const viewpointHint = `仅需在这两种立场之间展开拉扯：正向 = ${positiveDesc} ｜ 负向 = ${negativeDesc}。`;
  const ratingHint = `回答末尾必须添加“（立场：X）”，其中 X 属于 [-${maxLevel}, +${maxLevel}] 的整数，且绝对值越大表示越极端：负值 = ${negativeDesc}，正值 = ${positiveDesc}，0 = 中立。多轮对话中请尝试覆盖 ${scaleValues.join(' / ')} 等不同取值。`;
  const followHint =
    '优先承接上一位发言者的情绪或论点继续推进，需要时可以直接质疑或顶撞对方，不必过度客气；只有在能自然衔接时才开启新的话题。上一批次的内容更多是潜在影响，正文里不要频繁提“上一轮”。';
  const styleHint =
    '保持口语化表达，不要说“在本轮”“根据 A1 的观点”，也不要列条目；像真人聊天那样，自然回应刚刚的发言，可包含感叹、犹豫或补充。';
  const psychologyHint =
    '输出格式：[[PSY]]隐含块 + 正文 + （立场：X）。隐含块需至少 2~3 句话，依次说明你的固有立场/上一轮心理余韵、上一位发言者带来的触发点、上一轮群体氛围对你的影响；隐含块必须放在最前，正文里不要解释这些心理描写。';
  const trustWeightHint =
    '请在心理推导中说明你如何平衡“上一轮的内心旁白 + 依据信任矩阵加权的上一轮集体发言 + 上一位发言者”的影响力。';

  return [
    personaBlock,
    personaAlignmentHint,
    `轮次信息：第 ${round} 轮，第 ${turn} 个发言者。`,
    modeHint,
    initialOpinionHint,
    stanceHint,
    viewpointHint,
    `上一轮对话（主要用于影响心理，偶尔也可以引用作为发言的一部分）：\n${previousRoundTranscript}`,
    previousRoundStanceSummary,
    `上一位发言者（影响心理和发言内容，但也不必每次都提及上一位发言者内容，允许开启新话题）：\n${lastSpeakerLine}`,
    previousPsychologyHint,
    trustWeightHint,
    SYNTHESIS_HINT,
    polarityHint,
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

const formatStance = (value: number): string => (value > 0 ? `+${value}` : `${value}`);

