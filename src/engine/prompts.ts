import { describePersona } from './persona';
import type { AgentSpec, DialogueMode, Message, PromptToggleConfig } from '../types';
import { DEFAULT_PROMPT_TOGGLES } from '../types';
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

export const AGENT_OUTPUT_JSON_SCHEMA_NO_STANCE = `{
  "state": {
    "personal_memory": ["我依旧坚持循证的节奏", "这次的质疑让我更谨慎"],
    "others_memory": ["A2 - 指出了数据漏洞", "A3 - 给了情绪安慰"],
    "long_term": ["人格 / 价值观……", "沟通风格或底层信念……"],
    "short_term": ["此刻情绪 / 生理状态……", "即时目标 / 风险判断……"]
  },
  "think": ["句子 1", "句子 2", "句子 3"],
  "content": ["句子 1", "句子 2", "句子 3"]
}`;

export const AGENT_OUTPUT_JSON_SCHEMA_NO_THINK = `{
  "state": {
    "personal_memory": ["我依旧坚持循证的节奏", "这次的质疑让我更谨慎"],
    "others_memory": ["A2 - 指出了数据漏洞", "A3 - 给了情绪安慰"],
    "long_term": ["人格 / 价值观……", "沟通风格或底层信念……"],
    "short_term": ["此刻情绪 / 生理状态……", "即时目标 / 风险判断……"]
  },
  "content": ["句子 1", "句子 2", "句子 3"],
  "stance": { "score": 1, "label": "正向" }
}`;

export const AGENT_OUTPUT_JSON_SCHEMA_NO_THINK_NO_STANCE = `{
  "state": {
    "personal_memory": ["我依旧坚持循证的节奏", "这次的质疑让我更谨慎"],
    "others_memory": ["A2 - 指出了数据漏洞", "A3 - 给了情绪安慰"],
    "long_term": ["人格 / 价值观……", "沟通风格或底层信念……"],
    "short_term": ["此刻情绪 / 生理状态……", "即时目标 / 风险判断……"]
  },
  "content": ["句子 1", "句子 2", "句子 3"]
}`;

export const AGENT_OUTPUT_JSON_SCHEMA_NO_STATE = `{
  "think": ["句子 1", "句子 2", "句子 3"],
  "content": ["句子 1", "句子 2", "句子 3"],
  "stance": { "score": 1, "label": "正向" }
}`;

export const AGENT_OUTPUT_JSON_SCHEMA_NO_STATE_NO_STANCE = `{
  "think": ["句子 1", "句子 2", "句子 3"],
  "content": ["句子 1", "句子 2", "句子 3"]
}`;

export const AGENT_OUTPUT_JSON_SCHEMA_CONTENT_ONLY = `{
  "content": ["句子 1", "句子 2", "句子 3"],
  "stance": { "score": 1, "label": "正向" }
}`;

export const AGENT_OUTPUT_JSON_SCHEMA_CONTENT_ONLY_NO_STANCE = `{
  "content": ["句子 1", "句子 2", "句子 3"]
}`;

const SYNTHESIS_HINT =
  '思考时需同步感知：你当前的内在状态、上一轮保留下来的思考摘要、上一位发言者的最新刺激，以及上一轮所有 Agent 的整体氛围；不要机械复述，而要把这些线索熔炼成新的表达。';
const buildEnforcementWarning = (fields: string[]) =>
  `注意：整段输出必须是合法 JSON，且仅包含 ${fields.join('、')} 顶级字段；若 JSON 无法解析、字段缺失或字段内容为空，系统会判定本轮输出无效并强制跳过。`;

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
  /** Full history messages before current turn; used when outputInnerState=false (transcript memory). */
  historyMessages?: Message[];
  previousThoughtSummaries: Array<{ agentName: string; thoughtSummary: string; round: number }>;
  previousInnerStates: Array<{ agentName: string; innerState: string; round: number }>;
  selfPreviousMessage?: Message;
  promptToggles?: PromptToggleConfig;
  contentLengthTarget?: number;
  forcePersonalExample?: boolean;
  systemPromptExtra?: string;
  /** When provided, the system will fill stance.score and the model must omit the stance field. */
  forcedStanceScore?: number;
}

const buildHistoryTranscript = (
  history: Message[],
  agent: AgentSpec,
  agentNames: Record<string, string>,
): string => {
  if (!history || history.length === 0) return '（暂无历史对话）';
  return history
    .map((message) => {
      const speakerName = agentNames[message.agentId] ?? message.agentId;
      const roleLabel = message.agentId === agent.id ? `我（${agent.name}）` : `他人（${speakerName}）`;
      const content = message.content === '__SKIP__' ? '(跳过)' : message.content;
      const stanceNote =
        typeof message.stance?.score === 'number'
          ? `（立场：${formatStance(message.stance.score)}｜${message.stance.note ?? '未注明'}）`
          : '';
      return `${roleLabel}: ${content}${stanceNote}`;
    })
    .join('\n');
};

export const buildAgentSystemPrompt = ({
  agent,
  mode,
  trustWeights,
  stanceScaleSize,
  positiveViewpoint,
  negativeViewpoint,
  previousThoughtSummaries,
  previousInnerStates,
  promptToggles,
  contentLengthTarget,
  forcePersonalExample,
  systemPromptExtra,
  forcedStanceScore,
}: AgentPromptOptions): string => {
  const toggles = promptToggles
    ? { ...DEFAULT_PROMPT_TOGGLES, ...promptToggles }
    : { ...DEFAULT_PROMPT_TOGGLES };
  const personaEnabled = toggles.persona !== false;
  const trustMatrixEnabled = toggles.trustMatrix !== false;
  const randomLengthEnabled = toggles.randomLength !== false;
  const outputInnerStateEnabled = toggles.outputInnerState !== false;
  const outputThinkEnabled = toggles.outputThink !== false;
  // Structured memory relies on structured inner state being present.
  const memoryEnabled = toggles.memory !== false && outputInnerStateEnabled;
  const personaRaw = describePersona(agent.persona).trim();
  const personaBlock =
    personaEnabled && personaRaw.length > 0
      ? `人格画像：【\n${personaRaw}\n】`
      : personaEnabled
        ? '人格画像：【（未提供画像，请保持中性口吻）】'
        : undefined;
  const personaAlignmentHint = personaEnabled
    ? '一致性要求：state / think / content 必须与你的人格画像一致；立场方向以（系统锁定的 stance.score / 初始立场 / 对话证据）为准。如需改变立场，必须在 think 或 content 中给出明确触发点与理由。'
    : undefined;
  const trustSection =
    trustMatrixEnabled && trustWeights.length > 0
      ? `参考权重（权重越大越优先吸收/引用；请避免在 content 中提到“矩阵/权重”等内部词）：
${trustWeights
  .map((item) => {
    const selfMark = item.agentName === agent.name ? ' ← 这是“我”' : '';
    return `- ${item.agentName}: ${item.weight.toFixed(2)}${selfMark}`;
  })
  .join('\n')}
提示：权重高不等于盲从，仍需保持论证自洽。`
      : trustMatrixEnabled
        ? '参考权重：未提供特定偏好，可均匀参考所有 Agent 的上一批次发言。'
        : undefined;
  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const positiveDesc = ensurePositiveViewpoint(positiveViewpoint);
  const negativeDesc = ensureNegativeViewpoint(negativeViewpoint);
  const stanceLine = `讨论议题（立场极性）：
  - 正向：${positiveDesc}
  - 负向：${negativeDesc}`;
  const polarityMapping = `极性映射（非常重要，禁止搞反）：
  - stance.score > 0 代表正向（支持“${positiveDesc}”）
  - stance.score < 0 代表负向（支持“${negativeDesc}”）
  - stance.score = 0 为中立/摇摆`;
  const ratingLine =
    typeof forcedStanceScore === 'number' && Number.isFinite(forcedStanceScore)
      ? `首轮立场已锁定：本轮 stance.score 固定为 ${Math.round(forcedStanceScore)}（系统写入）。你无需输出 stance 字段，但 state/think/content 必须与该立场方向一致。\n${polarityMapping}`
      : `立场标注：stance.score 必须为 [-${maxLevel}, +${maxLevel}] 的整数；负值偏向“${negativeDesc}”，正值偏向“${positiveDesc}”，0 为中立。\n${polarityMapping}\n一致性要求：stance.label（或 note）必须与 score 的极性一致，不得写成相反一方。`;
  const personaStanceIndependence = `人格与立场的关系（实验与严谨性要求）：
  - 人格只影响表达风格、让步幅度、信息采样偏好与“更新规则”，不决定你站哪一边。
  - 立场方向由（系统锁定的 stance.score / 初始立场 / 对话证据）决定；禁止因为人格“看起来更像某一方”就擅自改写正负方向。`;
  const continuityGuidelines = `对话要求（精简）：
  - 优先回应上一位发言者；若开启新点，需解释衔接。
  - 避免复读；引用他人观点时用新角度/新证据推进。
  - 立场更新默认“小幅、连续”：相邻轮次 stance.score 的变化幅度建议不超过 1（除非出现决定性证据）。
  - 严禁为了迎合/和稀泥/讨好而改变立场；改变立场必须指向具体触发点（证据、逻辑矛盾被指出且你承认、关键事实更新）。
  - 禁止在单轮中跨越 0（例如从正值直接变负值，或反之）；如确需转向，必须先收敛到 0 附近再逐步跨越。`;
  const previousInnerStateSection =
    memoryEnabled
      ? previousInnerStates.length > 0
        ? `历史内在状态（仅你本人可见）：\n${previousInnerStates
            .map((item) => `- ${item.innerState}`)
            .join('\n')}`
        : '历史内在状态：暂无（首轮请优先遵守初始立场/初始观点）。'
      : undefined;
  const previousThoughtSection =
    memoryEnabled && outputThinkEnabled
      ? previousThoughtSummaries.length > 0
        ? `历史思考摘要（仅供自检，不要逐字引用）：\n${previousThoughtSummaries
            .map((item) => `- ${item.thoughtSummary}`)
            .join('\n')}`
        : '历史思考摘要：暂无（首轮请优先遵守初始立场/初始观点）。'
      : undefined;

  const innerStateGuidelines = outputInnerStateEnabled
    ? `state（内在状态，数组均 ≤3 条，超出则丢弃最旧）：
  - personal_memory：1~3 句，第一人称，记录你此刻要记住的信念/情绪/承诺（必须可从已发生对话推得出）。
  - others_memory：0~3 句，格式“<Agent 名> - 触发点”，只写你确实听到/理解到的刺激（首轮首发可为空数组）。
  - long_term：2~3 句，概括“我是谁/我坚持什么”（人格画像+初始立场+累积记忆）。
  - short_term：2~3 句，概括此刻情绪/目标/风险判断，以及最新刺激如何微调你。`
    : undefined;
  const innerStateGuidelinesBlock = memoryEnabled ? innerStateGuidelines : undefined;
  const thoughtGuidelines = outputThinkEnabled
    ? `think（思考摘要）：2~3 句，说明你如何被触发、你准备如何回应/反驳、为何做出该立场标注；不要与 content 逐字重复。`
    : undefined;
    const clampLengthTarget = (value: number) => Math.max(1, Math.min(3, Math.round(value)));
    const bodyLengthTarget =
      typeof contentLengthTarget === 'number'
        ? clampLengthTarget(contentLengthTarget)
        : randomLengthEnabled
          ? Math.floor(Math.random() * 3) + 1
          : 2;
    const includePersonalExample =
      randomLengthEnabled &&
      (typeof forcePersonalExample === 'boolean' ? forcePersonalExample : Math.random() < 0.2);
  const referenceLine = trustMatrixEnabled
    ? '- 可以参考权重更高者的观点/措辞，但必须保持自己的推理一致。'
    : undefined;
  const contentGuidelines = `content（发言内容）：${bodyLengthTarget} 句，自然口语表达；不得出现额外 JSON/标签/系统提示；不要在 content 中提“信任/权重/打分/刻度/评分”等内部词。
${referenceLine ?? ''}
${includePersonalExample ? '提示：可加入一个生活化例子（可假设），用来支撑论点。' : ''}`.trim();
  const stanceGuidelines = `stance（立场标签）：必须输出对象 {score, label?}；解释理由写进 think 或 content，不要扩展其它字段。`;
  const stanceLocked = typeof forcedStanceScore === 'number' && Number.isFinite(forcedStanceScore);
  const outputTopFields: string[] = [];
  if (outputInnerStateEnabled) outputTopFields.push('state');
  if (outputThinkEnabled) outputTopFields.push('think');
  outputTopFields.push('content');
  if (!stanceLocked) outputTopFields.push('stance');
  const outputContract = stanceLocked
    ? `输出契约（最高优先级）：
  - 只输出一个 JSON 对象，不要代码块，不要额外解释。
  - 顶级字段仅允许：${outputTopFields.join(' / ')}（本轮不要输出 stance）。
  - ${outputInnerStateEnabled ? 'state 必须非空；' : ''}${outputThinkEnabled ? 'think 必须非空；' : ''}content 必须非空。`
    : `输出契约（最高优先级）：
  - 只输出一个 JSON 对象，不要代码块，不要额外解释。
  - 顶级字段仅允许：${outputTopFields.join(' / ')}。
  - ${outputInnerStateEnabled ? 'state 必须非空；' : ''}${outputThinkEnabled ? 'think 必须非空；' : ''}content 必须非空；stance.score 必须为整数。`;
  const internalBan = `禁止项：
  - content 中禁止出现“系统提示/提示词/信任度矩阵/权重/立场评分/刻度/打分/评分/JSON/schema”等元叙述。`;
  const extraBlock =
    systemPromptExtra && systemPromptExtra.trim().length > 0
      ? `额外系统要求（在不违反“输出契约”的前提下优先遵守）：\n${systemPromptExtra.trim()}`
      : undefined;
  const outputFormatSample = `JSON 示例：\n${
    outputInnerStateEnabled
      ? outputThinkEnabled
        ? stanceLocked
          ? AGENT_OUTPUT_JSON_SCHEMA_NO_STANCE
          : AGENT_OUTPUT_JSON_SCHEMA
        : stanceLocked
          ? AGENT_OUTPUT_JSON_SCHEMA_NO_THINK_NO_STANCE
          : AGENT_OUTPUT_JSON_SCHEMA_NO_THINK
      : outputThinkEnabled
        ? stanceLocked
          ? AGENT_OUTPUT_JSON_SCHEMA_NO_STATE_NO_STANCE
          : AGENT_OUTPUT_JSON_SCHEMA_NO_STATE
        : stanceLocked
          ? AGENT_OUTPUT_JSON_SCHEMA_CONTENT_ONLY_NO_STANCE
          : AGENT_OUTPUT_JSON_SCHEMA_CONTENT_ONLY
  }`;

  const skipInstruction =
    mode === 'random'
      ? '本轮采用随机顺序发言，你仍需给出明确观点与论据，不得跳过。'
      : '本轮按固定顺序发言，请确保提供有效观点或补充，而不是跳过。';

  return [
    `你是一名多 Agent 观点演化系统中的参与者，请始终保持角色画像与沟通风格的一致性。`,
    outputContract,
    ratingLine,
    personaBlock,
    personaAlignmentHint,
    personaStanceIndependence,
    trustSection,
    extraBlock,
    stanceLine,
    continuityGuidelines,
    internalBan,
    innerStateGuidelinesBlock,
    thoughtGuidelines,
    contentGuidelines,
    stanceGuidelines,
    outputThinkEnabled || outputInnerStateEnabled ? SYNTHESIS_HINT : undefined,
    previousInnerStateSection,
    previousThoughtSection,
    `本轮发言要求：${skipInstruction}`,
    buildEnforcementWarning(outputTopFields),
    outputFormatSample,
  ].filter(Boolean).join('\n\n');
};

export const buildAgentUserPrompt = ({
  agent,
  mode,
  round,
  agentNames,
  stanceScaleSize,
  previousRoundMessages,
  lastSpeakerMessage,
  historyMessages,
  previousThoughtSummaries,
  previousInnerStates,
  selfPreviousMessage,
  promptToggles,
}: AgentPromptOptions): string => {
  const toggles = promptToggles
    ? { ...DEFAULT_PROMPT_TOGGLES, ...promptToggles }
    : { ...DEFAULT_PROMPT_TOGGLES };
  const outputInnerStateEnabled = toggles.outputInnerState !== false;
  const outputThinkEnabled = toggles.outputThink !== false;
  const transcriptMemoryEnabled = !outputInnerStateEnabled;
  const memoryEnabled = toggles.memory !== false && outputInnerStateEnabled;
  const historyTranscript = transcriptMemoryEnabled
    ? buildHistoryTranscript(historyMessages ?? [], agent, agentNames)
    : undefined;
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
      : '上一轮暂无对话（是首轮，需要与个人的初始立场和初始观点一致，首轮中初始立场和初始观点优先于人格画像）。';
  const previousRoundStanceSummary =
    transcriptMemoryEnabled
      ? undefined
      : previousRoundMessages.length
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
  const previousInnerStateHint = memoryEnabled
    ? previousInnerStates.length > 0
      ? `历史内在状态（仅限你本人，按时间排序）：\n${previousInnerStates
          .map((item) => `- ${item.innerState}`)
          .join('\n')}`
      : '暂未记录到你的历史内在状态，可结合角色设定自我推断。'
    : undefined;
  const previousThoughtHint = memoryEnabled && outputThinkEnabled
    ? previousThoughtSummaries.length > 0
      ? `历史思考摘要（仅供自检，不要逐字引用）：\n${previousThoughtSummaries
          .map((item) => `- ${item.thoughtSummary}`)
          .join('\n')}`
      : '暂未记录到思考摘要，可根据当前情境自行补全。'
    : undefined;
  const personalMemoryHint = memoryEnabled && !transcriptMemoryEnabled
    ? selfPreviousMessage?.personalMemory && selfPreviousMessage.personalMemory.length > 0
      ? `你的记忆存档（你在上一轮 state.personal_memory 中留下的 1~3 句，将在下一轮继续回放）：\n${selfPreviousMessage.personalMemory
          .map((item, index) => `- 记忆 ${index + 1}: ${item}`)
          .join('\n')}`
      : '你的记忆存档：暂无。请在本轮 state.personal_memory 中写下 1~3 句关键信息，方便下次回放。'
    : undefined;

  const modeHint =
    mode === 'sequential'
      ? '当前为依次发言模式，请紧扣固定顺序提供有效观点或补充。'
      : '当前为随机顺序发言模式，请在出场机会内明确表达立场与理由。';

  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const scaleValues = buildScaleValues(stanceScaleSize);
  const initialOpinionHint = agent.initialOpinion
    ? `该角色的初始观点：${agent.initialOpinion}`
    : '初始观点未预设，请结合人格画像与价值观推导一个最符合角色的判断，并在发言中给出理由。';
  const selfLastStance = selfPreviousMessage?.stance;
  const stanceHint =
    round === 1
        ? typeof agent.initialStance === 'number' && Number.isFinite(agent.initialStance)
          ? `该角色的初始立场已锁定：${formatStance(agent.initialStance)}（范围 ±${maxLevel}）。本轮无需输出 stance 字段；请补全 state/think/content 并让内容与该立场一致。\n极性映射提醒：正值=正向（正方），负值=负向（反方），0=中立（禁止把正负语义写反）。\n人格不决定立场方向：任何人格都可能持有任何立场；人格只影响表达与更新规则。`
          : `首轮尚未设定明确立场，请结合人格画像与初始观点推导出最合理的刻度（参考 ${scaleValues.join(' / ')}），并说明依据。`
        : selfLastStance
          ? `上一轮你的立场：${formatStance(selfLastStance.score)}（${selfLastStance.note ?? '未注明'}）。
立场更新规则（更严格）：
- 默认只做小幅更新：与上一轮相比，stance.score 变化建议不超过 1。
- 禁止单轮跨越 0（从正到负或从负到正）；若确需转向，请先收敛到 0 再逐步跨越。
- 不得为了迎合/缓和冲突而改分；如要改分，必须在 think 或 content 中明确写出触发点（证据/逻辑/事实更新）。`
          : '上一轮你未给出立场刻度：请先给出稳定且可解释的刻度；后续每轮仅允许小幅更新，且禁止单轮跨越 0。';
  const dynamicContext: Array<string | undefined> = [
    modeHint,
    initialOpinionHint,
    stanceHint,
    transcriptMemoryEnabled
      ? `至今对话记录（你是“我（${agent.name}）”，其余为“他人(...)”）：\n${historyTranscript ?? '（暂无历史对话）'}`
      : `上一轮对话（主要用于影响内在状态与思考，偶尔也可以引用作为发言的一部分）：\n${previousRoundTranscript}`,
    transcriptMemoryEnabled ? undefined : previousRoundStanceSummary,
    transcriptMemoryEnabled
      ? `提醒：你是“我（${agent.name}）”，请用第一人称说话。`
      : `上一位发言者（影响内在状态/思考与发言内容，但也不必每次都引用上一位的内容，允许开启新话题）：\n${lastSpeakerLine}`,
    transcriptMemoryEnabled ? undefined : previousInnerStateHint,
    transcriptMemoryEnabled ? undefined : previousThoughtHint,
    transcriptMemoryEnabled ? undefined : personalMemoryHint,
  ];
  return dynamicContext.filter(Boolean).join('\n\n');
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

