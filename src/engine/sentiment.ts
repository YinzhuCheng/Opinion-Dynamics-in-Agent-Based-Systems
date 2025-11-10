import type { SentimentSetting } from '../types';

export const resolveSentimentLabels = (setting: SentimentSetting): string[] => {
  if (setting.mode === 'byList') {
    return (setting.labels ?? []).filter((label) => !!label && label.trim()).map((label) => label.trim());
  }
  const count = Math.max(2, setting.count ?? 3);
  switch (count) {
    case 2:
      return ['正向', '负向'];
    case 3:
      return ['正向', '中性', '负向'];
    case 4:
      return ['强烈正向', '适度正向', '适度负向', '强烈负向'];
    case 5:
      return ['高兴', '平静', '担忧', '愤怒', '悲伤'];
    default:
      return Array.from({ length: count }, (_, index) => `标签${index + 1}`);
  }
};
