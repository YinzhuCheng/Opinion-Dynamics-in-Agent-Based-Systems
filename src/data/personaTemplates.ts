import type { MBTICode } from '../types';

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

export const MBTI_SUMMARIES: Record<MBTICode, string> = {
  INTJ: 'INTJ｜策划者：注重长期规划与系统性推理，偏好结构化的逻辑论证。',
  INTP: 'INTP｜分析者：善于抽象拆解复杂问题，喜欢探索新颖概念与假设。',
  ENTJ: 'ENTJ｜指挥官：天生的组织者，强调效率、目标和明确的行动路径。',
  ENTP: 'ENTP｜辩论家：思维敏捷、好奇心强，擅长用不同角度挑战既有观点。',
  INFJ: 'INFJ｜洞察者：注重价值与愿景，擅长在冲突中寻找更高层次的共识。',
  INFP: 'INFP｜调和者：以同理心和价值观引导交流，关注情绪与动机的深层逻辑。',
  ENFJ: 'ENFJ｜倡导者：富有感染力，善于串联群体情绪并引导团队朝共同目标迈进。',
  ENFP: 'ENFP｜创意者：灵活乐观，喜欢用故事与隐喻激发合作与新的想法。',
  ISTJ: 'ISTJ｜监察者：脚踏实地、注重事实，强调规则、责任与执行的可控性。',
  ISFJ: 'ISFJ｜守护者：细致耐心，关注团队福祉并主动弥补潜在风险。',
  ESTJ: 'ESTJ｜执行者：偏好直接高效的沟通方式，强调结构、指标与可衡量结果。',
  ESFJ: 'ESFJ｜协调者：重视人际和谐，擅长分配任务并及时提供情绪支持。',
  ISTP: 'ISTP｜实干家：冷静务实，善于拆解问题并提出可落地的技术性方案。',
  ISFP: 'ISFP｜体验者：敏感且包容，倾向从个体感受出发寻找富有温度的解决思路。',
  ESTP: 'ESTP｜开拓者：反应迅速，喜欢现场试探并以实证或案例推动决策。',
  ESFP: 'ESFP｜共情者：积极外向，善用故事与体验化语言吸引注意并凝聚共识。',
};
