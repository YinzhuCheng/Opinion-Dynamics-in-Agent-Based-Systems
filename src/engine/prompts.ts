import { describePersona } from './persona';
import type { AgentSpec, DialogueMode, Message } from '../types';
import {
  ensureNegativeViewpoint,
  ensurePositiveViewpoint,
} from '../constants/discussion';

export const AGENT_OUTPUT_JSON_SCHEMA = `{
  "state": {
    "personal_memory": ["我依旧坚持循证的节奏", "这次的质疑让我更谨慎"],
    "others_memory": ["A2 - 指出了数据漏洞", "A3 - 给了情绪安慰"],
    "long_term": ["人格 / 价值观……", "沟通风格或底层信念……"],
    "short_term": ["此刻情绪 / 生理状态……", "即时目标 / 风险判断……"]
  },
  "think": ["句子 1", "句子 2", "句子 3"],
  "content": ["句子 1", "句子 2", "句子 3"],
  "stance": { "score": 1, "label": "正向" }
}`;

const SYNTHESIS_HINT =
  '思考时需同步感知：你当前的内在状态、上一轮保留下来的思考摘要、上一位发言者的最新刺激，以及上一轮所有 Agent 的整体氛围；不要机械复述，而要把这些线索熔炼成新的表达。';
const ENFORCEMENT_WARNING =
  '注意：整段输出必须是合法 JSON，且仅包含 state、think、content、stance 四个顶级字段；若 JSON 无法解析、字段缺失或字段内容为空，系统会判定本轮输出无效并强制跳过。';

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
  previousThoughtSummaries: Array<{ agentName: string; thoughtSummary: string; round: number }>;
  previousInnerStates: Array<{ agentName: string; innerState: string; round: number }>;
  selfPreviousMessage?: Message;
}

export const buildAgentSystemPrompt = ({
  agent,
  mode,
  trustWeights,
  stanceScaleSize,
  positiveViewpoint,
  negativeViewpoint,
  previousThoughtSummaries,
  previousInnerStates,
}: AgentPromptOptions): string => {
  const personaRaw = describePersona(agent.persona).trim();
  const personaBlock =
    personaRaw.length > 0
      ? `人格画像：【\n${personaRaw}\n】`
      : '人格画像：【（未提供画像，请保持中性口吻）】';
  const personaAlignmentHint =
    '请让“内在状态 + 思考摘要 + 外显措辞”始终贴合人格画像 / MBTI / 大五人格与初始立场设定，不可自相矛盾。';
  const trustSection =
    trustWeights.length > 0
      ? `信任度矩阵（上一批次发言的参考权重，符合 DeGroot 聚合思路）：
${trustWeights
  .map((item) => {
    const selfMark = item.agentName === agent.name ? ' ← 这是“我”' : '';
    return `- ${item.agentName}: ${item.weight.toFixed(2)}${selfMark}`;
  })
  .join('\n')}
权重越大代表越信任；对你自己（标记为“我”）的权重代表自我参考的稳定程度，其余权重代表你对他人观点的吸收强度。`
      : '信任度矩阵：未提供特定偏好，可均匀参考所有 Agent 的上一批次发言。';
  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const scaleValues = buildScaleValues(stanceScaleSize);
  const positiveDesc = ensurePositiveViewpoint(positiveViewpoint);
  const negativeDesc = ensureNegativeViewpoint(negativeViewpoint);
    const stanceLine = `当前仅讨论一组对立立场：
  - 正向：${positiveDesc}
  - 负向：${negativeDesc}`;
    const ratingLine = `"stance.score" 必须写成 [-${maxLevel}, +${maxLevel}] 范围内的整数；绝对值越大代表越极端地支持正向或负向立场，0 表示完全中立。若需要解释评分，只能写进 content 数组的句子里，不能出现在 stance 对象中。`;
  const coverageHint = `刻度示例：${scaleValues.join(' / ')}。负值对应“${negativeDesc}”，正值对应“${positiveDesc}”。多轮对话中请主动探索不同强度，而不是永远停在单一取值。`;
    const continuityGuidelines = `对话策略：
    - 参考上一批次的整体氛围构建“潜台词”，但在发言内容里以口语化方式继续讨论，不要频繁提“上一轮/上一批次”。
  - 大部分情况下请顺着上一位发言者的视角继续推进；仅在确有必要时（小概率）开启新的细节或话题，且要解释衔接。
  - 遇到观点冲突可直接反驳或追问，不必刻意礼貌，带争执语气以保持真实感。
  - 若上一轮的内在状态已出现明显动摇，请允许极性反转：可以从支持转为反对或相反方向，只要给出充分理由。`;
    const previousInnerStateSection =
      previousInnerStates.length > 0
        ? `历史内在状态（仅你本人可见，按时间从旧到新）：\n${previousInnerStates
            .map((item) => `- ${item.innerState}`)
            .join('\n')}`
        : '历史内在状态：暂无记录（可能是首轮或之前跳过），请结合角色画像自行推断。';
    const previousThoughtSection =
      previousThoughtSummaries.length > 0
        ? `历史思考摘要（仅供自检，不要原文引用）：\n${previousThoughtSummaries
            .map((item) => `- ${item.thoughtSummary}`)
            .join('\n')}`
        : '历史思考摘要：暂无记录，可根据角色设定与对话氛围自我推断。';
const innerStateGuidelines = `内在状态机制（JSON 字段 state）：
  1. state.personal_memory：数组，1~3 句，用第一人称记录你此刻最想保留的记忆（信念、情绪、承诺等）；不要写“第几轮”或编号，这些句子将在下一次出场时原样回放给你。
  2. state.others_memory：数组，1~3 句，以“<Agent 名> - 触发点”的格式记录他人对你的刺激；该部分仅供系统建模，下一轮不会回放给任何人，因此内容要高度凝练。
  3. state.long_term：数组，使用 2~3 句描述人格画像、MBTI、大五人格、价值观、沟通风格、初始立场和累积记忆，明确“我本来是谁、始终坚持什么”。
  4. state.short_term：数组，使用 2~3 句描述此刻的情绪、生理状态、安全感、即时目标、对他人可靠性的判断，并指出最新刺激如何造成微调。
  - 四个数组都采用滑动窗口：多于 3 句时立刻移除最旧句子，只保留最新条目。
  - 引用时结合上一轮保存的 state / think 以及上一轮各 Agent 的公开发言与信任度偏好，明确哪些因素维持稳定、哪些发生更新。
  - state 的句子不可在 content 中逐字复述，可换角度延伸。`;
const thoughtGuidelines = `思考摘要机制（JSON 字段 think）：
  - think 是字符串数组，至少 2~3 句，描述你在本轮的即时推理：上一轮残留的问题、上一位发言者如何触发你、你准备如何组织发言内容或反驳。
  - 每句都要点名某个内在状态因素（例如信任度、情绪、记忆条目）如何影响推理；保持第一人称，不要与 content 重复。`;
    const bodyLengthTarget = Math.floor(Math.random() * 4) + 2;
    const includePersonalExample = Math.random() < 0.2;
    const personalExampleLine = includePersonalExample
      ? '  - 本轮请额外加入一则你自己或身边人的真实体验，为论点提供生活化细节。'
      : '';
    const contentGuidelines = `发言内容机制（JSON 字段 content）：
    - content 是唯一对外公开的语言输出，请结合 state 与 think 的线索，按照下方“日常表达提示”给出的句数自然表达，回应当前局面或提出新观点。
    - 数组内只能放自然语言句子，不得嵌入额外 JSON、标签或系统提示；句子之间可通过语气词、顿号等保持口语感。
    - 优先引用上一位发言者、信任度矩阵偏好或长期记忆中的张力，解释你为何做出该轮发言。`;
    const stanceGuidelines = `情感标签机制（JSON 字段 stance）：
    - stance 必须是对象，包含 score（整数）与可选 label（你可以用自己的措辞描述此刻的情感或立场备注）。
    - score 的合法范围、含义与极性要求见下方输出要求；若需要解释理由，请写回 content，而不是在 stance 对象里扩展字段。
    - 若上一轮的 state / think 已显露动摇，本轮的 stance.score 应给出相应调整，以便系统追踪波动。`;
  const naturalGuidelines = `日常表达提示（适用于 content 数组）：
    - 像即时聊天一样说话，可包含停顿、语气词或自我修正。
    - 使用“我/我们/你”来指代角色，不要说“根据 A1 的观点”“在本轮”等元叙述。
    - 避免模板化句式或编号，拆成两三句短句更自然。
    - 发言内容长度为 ${bodyLengthTarget} 句
${personalExampleLine}
    - 发言内容不要逐字复述 state 或 think 的句子，可换角度延伸那些信息。
    - 不要在输出里提到“信任度矩阵”“立场评分”等内部术语。`;
    const outputFormatSample = `输出格式（合法 JSON）：
${AGENT_OUTPUT_JSON_SCHEMA}`;

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
      innerStateGuidelines,
      thoughtGuidelines,
      contentGuidelines,
      stanceGuidelines,
    SYNTHESIS_HINT,
    previousInnerStateSection,
    previousThoughtSection,
      `输出要求：
- 使用简洁段落阐述论点，可包含条列说明。
- ${skipInstruction}
- 如需提出后续行动建议或结论，请在末尾表达。
  - JSON 中的 content 数组必须包含完整的发言内容，stance.score 需与 content 保持一致的立场方向，并紧随其后。
  - ${ratingLine}
  - ${coverageHint}
  - ${ENFORCEMENT_WARNING}

  ${naturalGuidelines}

  ${outputFormatSample}`,
  ].filter(Boolean).join('\n\n');
};

export const buildAgentUserPrompt = ({
  agent,
  mode,
  round,
  agentNames,
  stanceScaleSize,
  positiveViewpoint: _positiveViewpoint,
  negativeViewpoint: _negativeViewpoint,
  previousRoundMessages,
  lastSpeakerMessage,
  previousThoughtSummaries,
  previousInnerStates,
  selfPreviousMessage,
}: AgentPromptOptions): string => {
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
  const previousInnerStateHint =
    previousInnerStates.length > 0
      ? `历史内在状态（仅限你本人，按时间排序）：\n${previousInnerStates
          .map((item) => `- ${item.innerState}`)
          .join('\n')}`
      : '暂未记录到你的历史内在状态，可结合角色设定自我推断。';
  const previousThoughtHint =
    previousThoughtSummaries.length > 0
      ? `历史思考摘要（仅供自检，不要逐字引用）：\n${previousThoughtSummaries
          .map((item) => `- ${item.thoughtSummary}`)
          .join('\n')}`
      : '暂未记录到思考摘要，可根据当前情境自行补全。';
  const personalMemoryHint =
    selfPreviousMessage?.personalMemory && selfPreviousMessage.personalMemory.length > 0
      ? `你的记忆存档（你在上一轮 state.personal_memory 中留下的 1~3 句，将在下一轮继续回放）：\n${selfPreviousMessage.personalMemory
          .map((item, index) => `- 记忆 ${index + 1}: ${item}`)
          .join('\n')}`
      : '你的记忆存档：暂无。请在本轮 state.personal_memory 中写下 1~3 句关键信息，方便下次回放。';

  const modeHint =
    mode === 'sequential'
      ? '当前为依次发言模式，请紧扣固定顺序提供有效观点或补充。'
      : '当前为随机顺序发言模式，请在出场机会内明确表达立场与理由。';

  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const scaleValues = buildScaleValues(stanceScaleSize);
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
          ? `上一轮你的立场：${formatStance(selfLastStance.score)}（${selfLastStance.note ?? '未注明'}）。若当时的内在状态或思考摘要已开始动摇，可在本轮调整甚至反转立场，但必须说明触发点。`
          : '上一轮你未给出立场刻度，可回顾当时的内在状态与思考摘要，自行决定是维持、收敛还是反转。';
  const dynamicContext: string[] = [
    modeHint,
    initialOpinionHint,
    stanceHint,
    `上一轮对话（主要用于影响内在状态与思考，偶尔也可以引用作为发言的一部分）：\n${previousRoundTranscript}`,
    previousRoundStanceSummary,
    `上一位发言者（影响内在状态/思考与发言内容，但也不必每次都引用上一位的内容，允许开启新话题）：\n${lastSpeakerLine}`,
    previousInnerStateHint,
    previousThoughtHint,
    personalMemoryHint,
  ];
  return dynamicContext.join('\n\n');
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

