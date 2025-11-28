import { BIG5_TRAIT_LABELS, MBTI_SUMMARIES } from '../data/personaTemplates';
import type { Persona, PersonaBig5, PersonaMBTI, PersonaFree } from '../types';

export const describePersona = (persona: Persona): string => {
  switch (persona.type) {
    case 'big5':
      return describeBig5(persona);
    case 'mbti':
      return describeMBTI(persona);
    case 'free':
    default:
      return describeFree(persona);
  }
};

type Big5BandKey = 'veryLow' | 'low' | 'medium' | 'high' | 'veryHigh';

const SCORE_BANDS: Array<{ key: Big5BandKey; max: number; label: string; range: string }> = [
  { key: 'veryLow', max: 20, label: '极低', range: '0~20' },
  { key: 'low', max: 40, label: '偏低', range: '21~40' },
  { key: 'medium', max: 60, label: '中等', range: '41~60' },
  { key: 'high', max: 80, label: '偏高', range: '61~80' },
  { key: 'veryHigh', max: 100, label: '极高', range: '81~100' },
];

const traitBaseline = {
  O: '开放性（Openness to Experience）：开放性涉及个体对新思想、新经验和文化多样性的接受程度。高开放性的人更具有想象力、创造力、好奇心和探索精神，而低开放性的人则更为传统、保守和习惯性。开放性与艺术、文化、科学等领域的兴趣和能力相关，高开放性的人可能更愿意接受新观点、尝试新体验、探索未知领域。',
  C: '尽责性（Conscientiousness）：尽责性涉及个体对目标的设定、计划制定、自我约束和执行能力的程度。高尽责性的人通常有条理、可靠、自律、有责任感，而低尽责性的人可能更为随性、冲动、不守承诺。尽责性与目标实现、时间管理、工作表现等相关，高尽责性的人通常更愿意付出努力、追求成功、保持自律。',
  E: '外倾性（Extraversion）：外倾性指个体对外部世界的关注、社交能力和情绪表达的程度。高外倾性的人通常喜欢社交活动，性格开朗、乐观、善于交际，而低外倾性的人则更为内向、安静和独立。外倾性与积极情绪、社交关系、冒险倾向等特质相关，高外倾性的人可能更愿意尝试新事物、寻求刺激和冒险。',
  A: '宜人性（Agreeableness）：宜人性指个体与他人相处的方式、亲社会性和合作性的程度。高宜人性的人通常友善、乐于助人、宽容和合作，而低宜人性的人可能更为独立、自我中心、不合群。宜人性与人际关系、团队合作、亲社会行为等相关，高宜人性的人可能更擅长处理人际关系、解决冲突、帮助他人。',
  N: '神经质（Neuroticism）：神经质涉及个体情绪稳定性和情绪反应的程度。高神经质的人更容易感受到焦虑、紧张、沮丧和易怒，而低神经质的人则更为冷静、放松和稳定。高神经质的人可能更容易受到压力和负面情绪的影响，而低神经质的人则更能保持情绪稳定和应对挑战。',
};

const traitNuances: Record<
  keyof typeof BIG5_TRAIT_LABELS,
  Record<Big5BandKey, string>
> = {
    O: {
      veryLow: '由于你的开放性极低，你会牢牢抱住既有框架，面对陌生观点语气紧绷、倾向直接否定，几乎不调整既定立场。',
      low: '开放性偏低，你在接受新点子前会层层验证，多半把对话拉回可被证实的细节，让观点演化非常缓慢。',
      medium: '开放性中等，你能在保守与探索之间找平衡，对充分论据会给出有限让步，使立场循序渐进地移动。',
      high: '开放性偏高，你乐于抛出跨界联想或替代方案，愿意在有道理时带头试验新的论述路径。',
      veryHigh: '由于你的开放性很高，你很愿意改变自己的观点，只要对方不是过于苛刻或保守；遇到分歧时你包容且平和，不与人争执，但也不会为了迎合而放弃判断。',
    },
    C: {
      veryLow: '由于你的责任心极低，你发言随性、容易跳题，常把评分或结论挪到最后一刻才决定，导致立场摇摆不定。',
      low: '责任心偏低，你虽能完成任务，却常凭当下情绪调整节奏，偶尔会跳过推理步骤，让对话显得松散。',
      medium: '责任心中等，你会在自由与秩序之间切换：当讨论混乱时自动补上结构，但也允许自己适度即兴。',
      high: '责任心偏高，你喜欢列清单、总结要点，并监督整体执行，发言中会不断校准评分与行动计划。',
      veryHigh: '责任心极高，你近乎苛求秩序，语气里常提醒他人守规与交付，若别人离题你会立即纠偏。',
    },
    E: {
      veryLow: '由于外向性极低，你更爱独自推理，公开场合语句短促，除非观点被误解，否则少有长篇输出。',
      low: '外向性偏低，你需要热身才肯表达，通常在关键节点才插话，语气偏冷静，耐心倾听多于发起攻势。',
      medium: '外向性中等，你会依据场合决定收放：对熟悉议题会侃侃而谈，对模糊主题则先观察后补充。',
      high: '外向性偏高，你擅长带动氛围，常主动接话或主持讨论，并用更鲜活的故事推进自己的立场。',
      veryHigh: '外向性极高，你几乎在任何场合都能迅速点燃话题，引导别人跟随，也乐于用高能量语气影响最终评分。',
    },
    A: {
      veryLow: '由于你的宜人性很低，你倾向于否认别人的观点，经常会和人起争执，语气尖锐，宁可维护立场也不轻易让步。',
      low: '宜人性偏低，你会直接指出问题、维护边界，虽然还能保持礼貌，但反驳时不太考虑对方感受。',
      medium: '宜人性中等，你会在锋利表达与圆融语气之间切换：必要时据理力争，场面紧张时又能缓和冲突。',
      high: '宜人性偏高，你习惯先肯定对方再提出异议，容易用合作语气把讨论引向折中方案。',
      veryHigh: '由于你的宜人性很高，你倾向于接受别人的观点，很少和人起争执，语气和谐，甚至会为了迎合他人而调整自己的立场。',
    },
    N: {
      veryLow: '神经质极低的你在高压下依旧冷静，发言稳健、评分波动小，很少被情绪带偏。',
      low: '神经质偏低，你偶尔紧张但能迅速复原，讲话时会提示风险，却不会让情绪影响论证。',
      medium: '神经质中等，你能觉察情绪起伏并加以说明，适度利用感受推动观点微调。',
      high: '神经质偏高，你对风险高度敏感，常提前提出警示或备援方案，也会在语气里显露焦虑，从而影响评分。',
      veryHigh: '由于你的神经质很高，你在思考过程中会有更多跳跃性，发言和最终评分经常不够理性，情绪波动也会主导你对观点的瞬时翻转。',
    },
};

const describeBig5Trait = (traitKey: keyof typeof BIG5_TRAIT_LABELS, rawScore: number): string => {
  const clamped = Math.max(0, Math.min(100, Math.round(rawScore)));
  const band = SCORE_BANDS.find((item) => clamped <= item.max) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
  const label = BIG5_TRAIT_LABELS[traitKey];
  const baseline = traitBaseline[traitKey];
  const nuance = traitNuances[traitKey][band.key];
  return `- ${label} ${clamped}（${band.label}，${band.range}）：${baseline} ${nuance}`;
};

const describeBig5 = (persona: PersonaBig5): string => {
  return [
    '大五人格（总分 100 分，数值越高越显著）：',
    describeBig5Trait('O', persona.O),
    describeBig5Trait('C', persona.C),
    describeBig5Trait('E', persona.E),
    describeBig5Trait('A', persona.A),
    describeBig5Trait('N', persona.N),
    '请让语气、情绪与以上性格刻度保持一致。',
  ].join('\n');
};

const describeMBTI = (persona: PersonaMBTI): string => {
  const summary = MBTI_SUMMARIES[persona.mbti];
  return summary ? summary : `MBTI 类型：${persona.mbti}`;
};

const describeFree = (persona: PersonaFree): string => {
  return persona.description?.trim() || '';
};
