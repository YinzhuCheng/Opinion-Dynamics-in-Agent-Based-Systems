export const DEFAULT_POSITIVE_VIEWPOINT = '支持项羽乌江自刎';
export const DEFAULT_NEGATIVE_VIEWPOINT = '反对项羽乌江自刎';

export const ensurePositiveViewpoint = (value?: string) =>
  value?.trim() || DEFAULT_POSITIVE_VIEWPOINT;

export const ensureNegativeViewpoint = (value?: string) =>
  value?.trim() || DEFAULT_NEGATIVE_VIEWPOINT;
