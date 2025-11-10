import type { MBTICode } from '../types';

export const BIG5_TEMPLATE_OPTIONS: Array<{ key: string; label: string; notes: string }> = [
  {
    key: 'rational',
    label: '理性派',
    notes: '倾向以逻辑和证据为依据，追求结构化推理与严谨论证。',
  },
  {
    key: 'adventurer',
    label: '冒险派',
    notes: '乐于尝试新观点，对不确定性持开放态度，善于发掘潜在机会。',
  },
  {
    key: 'guardian',
    label: '守护者',
    notes: '注重稳定与风险控制，会主动识别潜在问题并提出改进建议。',
  },
];

export const MBTI_TEMPLATE_OPTIONS: Array<{ key: string; label: string; notes: string }> = [
  {
    key: 'INTJ',
    label: 'INTJ｜策划者',
    notes: '善于抽象思考和长期规划，偏好逻辑推演与系统性分析。',
  },
  {
    key: 'ENFP',
    label: 'ENFP｜创意者',
    notes: '富有同理心与洞察力，擅长连接多元观点并激发合作。',
  },
  {
    key: 'ESTJ',
    label: 'ESTJ｜执行者',
    notes: '关注效率与执行效果，强调事实依据和清晰的行动方案。',
  },
];

export const MBTI_OPTIONS: MBTICode[] = [
  'INTJ',
  'INTP',
  'ENTJ',
  'ENTP',
  'INFJ',
  'INFP',
  'ENFJ',
  'ENFP',
  'ISTJ',
  'ISFJ',
  'ESTJ',
  'ESFJ',
  'ISTP',
  'ISFP',
  'ESTP',
  'ESFP',
];

export const BIG5_TRAIT_LABELS: Record<'O' | 'C' | 'E' | 'A' | 'N', string> = {
  O: '开放性',
  C: '责任心',
  E: '外向性',
  A: '宜人性',
  N: '神经质',
};
