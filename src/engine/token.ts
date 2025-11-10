import type { Message } from '../types';

export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  const sanitized = text.replace(/\s+/g, ' ').trim();
  if (!sanitized) {
    return 0;
  }
  // Rough heuristic: 1 token ≈ 4 characters
  return Math.ceil(sanitized.length / 4);
};

export const estimateMessageTokens = (message: Message): number => {
  return estimateTokens(message.content);
};

export const estimateMessagesTokens = (messages: Message[]): number => {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
};
