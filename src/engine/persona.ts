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
  O: '代表好奇心、想象力与对新事物的开放程度，数值越高越愿意挑战常规。',
  C: '体现自律、规划与责任感，高分意味着珍视承诺与可控流程。',
  E: '反映外向与能量释放方式，越高越喜欢公开表达与社交互动。',
  A: '关乎合作、宽容与共情，高值意味着乐于照顾关系、避免冲突。',
  N: '表示情绪敏感度与压力反应，得分越高越容易担忧、警觉潜在风险。',
};

const traitNuances: Record<
  keyof typeof BIG5_TRAIT_LABELS,
  Record<Big5BandKey, string>
> = {
  O: {
    veryLow: '由于该分数处于极低区间，你几乎只信赖既有流程，对跳脱想法会立即设防。',
    low: '该分数偏低，你在接受新点子前会层层验证，需要外部证据才愿意尝试。',
    medium: '分数居中，说明你能在保守与探索之间寻找平衡，必要时会尝试新思路。',
    high: '分数偏高，意味着你乐于发起新构想，愿意带头测试陌生方案。',
    veryHigh: '分数极高，你本能地挑战常规，喜欢把讨论推进到未知领域。',
  },
  C: {
    veryLow: '分数极低时，你更随性，容易忽视流程或延后承诺。',
    low: '该分数偏低，代表你虽能完成任务，但常依情绪调整节奏，对细则耐心有限。',
    medium: '分数居中，能在灵活与纪律之间切换，遇到关键节点仍会收紧节奏。',
    high: '分数偏高，你会主动制定计划并监督执行，讨厌模糊责任。',
    veryHigh: '分数极高，你对秩序近乎苛求，会不断提醒他人守住承诺。',
  },
  E: {
    veryLow: '分数极低，你更习惯独自思考，公开讨论时会尽量少说。',
    low: '该分数偏低，说明你需要时间热身才愿表达，通常只在必要时发言。',
    medium: '分数居中，能依据场合或能量状态决定安静或外放。',
    high: '分数偏高，你乐于带动氛围，常主动接话或主持讨论。',
    veryHigh: '分数极高，你几乎在任何场合都能迅速点燃话题，引导别人跟随。',
  },
  A: {
    veryLow: '分数极低时，你更重事实胜过关系，必要时会直接对抗。',
    low: '该分数偏低，代表你会维护界限，不怕指出问题，但仍保有基本礼貌。',
    medium: '分数居中，能在锋利表达与圆融语气之间切换。',
    high: '分数偏高，你习惯先安抚情绪再提出意见，善于弥合分歧。',
    veryHigh: '分数极高，你会优先守护团队和谐，甚至愿意暂时让步以换取信任。',
  },
  N: {
    veryLow: '分数极低，你对压力不敏感，能在混乱中保持冷静。',
    low: '该分数偏低，说明你偶尔紧张但多半能迅速复原。',
    medium: '分数居中，表示你能觉察情绪波动，也会寻找自我安定方式。',
    high: '分数偏高，你对风险非常敏感，常提前提出警示或备援方案。',
    veryHigh: '分数极高，你容易被情绪触发，需要不断确认安全感才能安心表达。',
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
