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
    `大五人格概况（满分 100）：`,
    `- ${BIG5_TRAIT_LABELS.O}：${persona.O}`,
    `- ${BIG5_TRAIT_LABELS.C}：${persona.C}`,
    `- ${BIG5_TRAIT_LABELS.E}：${persona.E}`,
    `- ${BIG5_TRAIT_LABELS.A}：${persona.A}`,
    `- ${BIG5_TRAIT_LABELS.N}：${persona.N}`,
  ].join('\n');
};

const describeMBTI = (persona: PersonaMBTI): string => {
  const summary = MBTI_SUMMARIES[persona.mbti];
  return summary ? summary : `MBTI 类型：${persona.mbti}`;
};

const describeFree = (persona: PersonaFree): string => {
  return persona.description?.trim() || '';
};
