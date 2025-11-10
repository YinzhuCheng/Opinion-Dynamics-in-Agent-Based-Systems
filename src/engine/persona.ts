import { BIG5_TEMPLATE_OPTIONS, BIG5_TRAIT_LABELS, MBTI_TEMPLATE_OPTIONS } from '../data/personaTemplates';
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
  const lines: string[] = [
    `大五人格概况（满分 100）：`,
    `- ${BIG5_TRAIT_LABELS.O}：${persona.O}`,
    `- ${BIG5_TRAIT_LABELS.C}：${persona.C}`,
    `- ${BIG5_TRAIT_LABELS.E}：${persona.E}`,
    `- ${BIG5_TRAIT_LABELS.A}：${persona.A}`,
    `- ${BIG5_TRAIT_LABELS.N}：${persona.N}`,
  ];
  if (persona.templateKey) {
    const template = BIG5_TEMPLATE_OPTIONS.find((item) => item.key === persona.templateKey);
    if (template?.notes) {
      lines.push(`性格关键词：${template.label}。${template.notes}`);
    }
  }
  if (persona.notes) {
    lines.push(`补充说明：${persona.notes}`);
  }
  return lines.join('\n');
};

const describeMBTI = (persona: PersonaMBTI): string => {
  const lines: string[] = [`MBTI 类型：${persona.mbti}`];
  if (persona.templateKey) {
    const template = MBTI_TEMPLATE_OPTIONS.find((item) => item.key === persona.templateKey);
    if (template?.notes) {
      lines.push(`典型沟通风格：${template.notes}`);
    }
  }
  if (persona.notes) {
    lines.push(`补充说明：${persona.notes}`);
  }
  return lines.join('\n');
};

const describeFree = (persona: PersonaFree): string => {
  return persona.description || '该 Agent 未提供额外画像，保持客观中立。';
};
