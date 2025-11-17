export const DEFAULT_POSITIVE_VIEWPOINT = '大语言模型的发展会造福人类';
export const DEFAULT_NEGATIVE_VIEWPOINT = '大语言模型的发展会威胁人类';

export const ensurePositiveViewpoint = (value?: string) =>
  value?.trim() || DEFAULT_POSITIVE_VIEWPOINT;

export const ensureNegativeViewpoint = (value?: string) =>
  value?.trim() || DEFAULT_NEGATIVE_VIEWPOINT;
