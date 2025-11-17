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

const describeBig5 = (persona: PersonaBig5): string => {
  return [
    '大五人格（数值越高越显著）：',
    `- ${BIG5_TRAIT_LABELS.O} ${persona.O}：代表好奇心、想象力与对新事物的开放程度，数值越高越愿意挑战常规。`,
    `- ${BIG5_TRAIT_LABELS.C} ${persona.C}：体现自律、规划与责任感，高分意味着珍视承诺与可控流程。`,
    `- ${BIG5_TRAIT_LABELS.E} ${persona.E}：反映外向与能量释放方式，越高越喜欢公开表达与社交互动。`,
    `- ${BIG5_TRAIT_LABELS.A} ${persona.A}：关乎合作、宽容与共情，高值意味着乐于照顾关系、避免冲突。`,
    `- ${BIG5_TRAIT_LABELS.N} ${persona.N}：表示情绪敏感度与压力反应，得分越高越容易担忧、警觉潜在风险。`,
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
