import { describePersona } from './persona';
import type { AgentSpec, DialogueMode, Message } from '../types';
import {
  ensureNegativeViewpoint,
  ensurePositiveViewpoint,
} from '../constants/discussion';

const SYNTHESIS_HINT =
  '思考时需同步感知：你当前的内在状态、上一轮保留下来的思考摘要、上一位发言者的最新刺激，以及上一轮所有 Agent 的整体氛围；不要机械复述，而要把这些线索熔炼成新的表达。';
const BLOCK_DEFINITION_HINT = `块含义：
[[STATE]] = “我是谁＆现在的滤镜”——3~5 句，先讲长期基线（人格画像、MBTI、大五、价值观、沟通风格、初始观点/立场、记忆摘要），再讲短期波动（情绪、生理状态、安全感、当前目标、对他人可靠性的判断）。
[[THINK]] = “我马上要怎么推理”——2~3 句，描述上一轮残留的问题、上一位发言者如何触发你、你准备如何组织正文或反驳，必须引用至少一个内在状态因素。
正文 = 口语化发言，像真人聊天那样推进讨论。
（立场：X） = 以括号包裹的整数刻度，总结本轮立场。`;

const OUTPUT_ORDER_HINT = `输出顺序（必须严格遵守）：
1. [[STATE]] …… [[/STATE]]
2. [[THINK]] …… [[/THINK]]
3. 正文（自然语言发言）
4. （立场：X）`;

const OUTPUT_FORMAT_SAMPLE = `示例格式：
[[STATE]]（长期基线与短期波动示例）[[/STATE]]
[[THINK]]（即时推理示例）[[/THINK]]
正文自然语言……（立场：+1）`;

const ENFORCEMENT_WARNING =
  '注意：若缺少 [[STATE]]、[[THINK]]、正文或结尾的“（立场：X）”，系统会判定本轮输出无效并强制跳过；请务必完整输出。';

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
  previousThoughtSummaries: Array<{ agentName: string; thoughtSummary: string }>;
  previousInnerStates: Array<{ agentName: string; innerState: string }>;
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
  const ratingLine = `正文末尾必须紧跟“（立场：X）”，X 属于 [-${maxLevel}, +${maxLevel}] 的整数；绝对值越大代表越极端地支持正向或负向立场，0 表示完全中立。不得另起一句解释评分。`;
  const coverageHint = `刻度示例：${scaleValues.join(' / ')}。负值对应“${negativeDesc}”，正值对应“${positiveDesc}”。多轮对话中请主动探索不同强度，而不是永远停在单一取值。`;
  const continuityGuidelines = `对话策略：
  - 参考上一批次的整体氛围构建“潜台词”，但在正文里以口语化方式继续讨论，不要频繁提“上一轮/上一批次”。
  - 大部分情况下请顺着上一位发言者的视角继续推进；仅在确有必要时（小概率）开启新的细节或话题，且要解释衔接。
  - 遇到观点冲突可直接反驳或追问，不必刻意礼貌，可带一点争执语气以保持真实感。
  - 若上一轮的内在状态已出现明显动摇，请允许极性反转：可以从支持转为反对或相反方向，只要给出充分理由。`;
  const previousInnerStateSection =
    previousInnerStates.length > 0
      ? `上一轮内在状态快照（只供你内化，不要在正文里引用）：\n${previousInnerStates
          .map((item) => `- ${item.agentName}: ${item.innerState}`)
          .join('\n')}`
      : '上一轮内在状态快照：暂无记录（可能是首轮或上一轮跳过），请结合角色画像自行推断。';
  const previousThoughtSection =
    previousThoughtSummaries.length > 0
      ? `上一轮思考摘要摘录（用于感知潜台词）：\n${previousThoughtSummaries
          .map((item) => `- ${item.agentName}: ${item.thoughtSummary}`)
          .join('\n')}`
      : '上一轮尚未形成可引用的思考摘要，可自行根据对话与信任权重推断群体情绪。';
  const innerStateGuidelines = `内在状态机制：
  - [[STATE]] 描述“你是谁、现在的滤镜如何”，需要拆开“长期基线”（人格画像、MBTI、大五因子、价值观、沟通风格、初始观点/立场、记忆摘要）与“短期波动”（情绪、生理状态、安全感、当前目标、对他人可靠性的判断）。3~5 句，每句都在讲述“你”的感受，不要泛泛而谈。
  - 允许把对自己或他人上一轮发言的记忆摘要写进 [[STATE]]，作为长期基线或最新滤镜的一部分，但仍要保持第一人称。
  - 记得引用上一轮自己的 [[STATE]]、[[THINK]] 以及信任度矩阵中的偏好，说明哪些部分保持稳定、哪些因外界刺激发生变化；[[STATE]] 只供系统记录，正文不要透露这些元信息。`;
  const thoughtGuidelines = `思考摘要机制：
  - [[THINK]] 描述你在本轮的即时推理：上一轮残留的问题、上一位发言者如何触发你、你准备如何组织正文或反驳。
  - 至少 2~3 句，明确点名某个内在状态因素（如信任度或情绪）如何影响推理；保持第一人称，不要复述正文。`;
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
    innerStateGuidelines,
    thoughtGuidelines,
    SYNTHESIS_HINT,
    previousInnerStateSection,
    previousThoughtSection,
      `输出要求：
- 使用简洁段落阐述论点，可包含条列说明。
- 不要以 JSON 或代码格式输出。
- ${skipInstruction}
- 如需提出后续行动建议或结论，请在末尾表达。
    - ${ratingLine}
    - ${coverageHint}
      - ${ENFORCEMENT_WARNING}
    - ${OUTPUT_ORDER_HINT}
    - ${BLOCK_DEFINITION_HINT}
    - ${OUTPUT_FORMAT_SAMPLE}

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
  previousThoughtSummaries,
  previousInnerStates,
  selfPreviousMessage,
}: AgentPromptOptions): string => {
  const personaRaw = describePersona(agent.persona).trim();
  const personaBlock =
    personaRaw.length > 0
      ? `人格画像：【\n${personaRaw}\n】`
      : '人格画像：【（未提供画像，请保持中性口吻）】';
  const personaAlignmentHint =
    '请确保“内在状态 + 思考摘要 + 发言”在语气、词汇、价值判断上都忠实于上述人格设定。';
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
      ? `上一轮内在状态（请仅作为潜台词吸收，不要逐条引用）：\n${previousInnerStates
          .map((item) => `- ${item.agentName}: ${item.innerState}`)
          .join('\n')}`
      : '上一轮尚未形成可引用的内在状态，可结合人格设定与对话自我推断。';
    const previousThoughtHint =
      previousThoughtSummaries.length > 0
        ? `上一轮思考摘要摘录（帮助你理解隐含思考与潜台词）：\n${previousThoughtSummaries
          .map((item) => `- ${item.agentName}: ${item.thoughtSummary}`)
          .join('\n')}`
      : '上一轮暂无思考摘要可用。';

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
          ? `上一轮你的立场：${formatStance(selfLastStance.score)}（${selfLastStance.note ?? '未注明'}）。若当时的内在状态或思考摘要已开始动摇，可在本轮调整甚至反转立场，但必须说明触发点。`
          : '上一轮你未给出立场刻度，可回顾当时的内在状态与思考摘要，自行决定是维持、收敛还是反转。';
  const polarityHint =
    '若上一轮的内在状态 / 思考摘要或外界刺激让你开始怀疑原有观点，可主动调整立场——包括极性反转——但要把变化写进 [[STATE]] 与 [[THINK]] 并在正文里给出充分理由。';
  const viewpointHint = `仅需在这两种立场之间展开拉扯：正向 = ${positiveDesc} ｜ 负向 = ${negativeDesc}。`;
  const ratingHint = `回答末尾必须添加“（立场：X）”，其中 X 属于 [-${maxLevel}, +${maxLevel}] 的整数，且绝对值越大表示越极端：负值 = ${negativeDesc}，正值 = ${positiveDesc}，0 = 中立。多轮对话中请尝试覆盖 ${scaleValues.join(' / ')} 等不同取值。`;
  const followHint =
    '优先承接上一位发言者的情绪或论点继续推进，需要时可以直接质疑或顶撞对方，不必过度客气；只有在能自然衔接时才开启新的话题。上一批次的内容更多是潜在影响，正文里不要频繁提“上一轮”。';
  const styleHint =
    '保持口语化表达，不要说“在本轮”“根据 A1 的观点”，也不要列条目；像真人聊天那样，自然回应刚刚的发言，可包含感叹、犹豫或补充。';
  const trustWeightHint =
    '请在 [[STATE]] 或 [[THINK]] 中说明你如何平衡“上一轮的内在状态/思考摘要 + 依据信任矩阵加权的上一轮集体发言 + 上一位发言者”的影响力。';
  const outputGuidanceHint = `${OUTPUT_ORDER_HINT}\n${BLOCK_DEFINITION_HINT}\n${OUTPUT_FORMAT_SAMPLE}\n${ENFORCEMENT_WARNING}`;

  return [
    personaBlock,
    personaAlignmentHint,
    `轮次信息：第 ${round} 轮，第 ${turn} 个发言者。`,
    modeHint,
    initialOpinionHint,
    stanceHint,
    viewpointHint,
      `上一轮对话（主要用于影响内在状态与思考，偶尔也可以引用作为发言的一部分）：\n${previousRoundTranscript}`,
    previousRoundStanceSummary,
      `上一位发言者（影响内在状态/思考与发言内容，但也不必每次都引用上一位的内容，允许开启新话题）：\n${lastSpeakerLine}`,
    previousInnerStateHint,
    previousThoughtHint,
    trustWeightHint,
    outputGuidanceHint,
    SYNTHESIS_HINT,
    polarityHint,
    followHint,
    styleHint,
    ratingHint,
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

