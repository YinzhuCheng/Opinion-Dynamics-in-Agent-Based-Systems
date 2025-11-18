import type { ModelConfig } from '../types';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ChatStreamStatus = 'waiting_response' | 'thinking' | 'responding' | 'done';

export interface ChatStreamHandlers {
  onStatus?: (status: ChatStreamStatus) => void;
  onToken?: (token: string) => void;
}

export interface ChatStreamExtra {
  temperature?: number;
  maxTokens?: number;
}

export async function chatStream(
  messages: ChatMessage[],
  config: ModelConfig,
  extra?: ChatStreamExtra,
  handlers?: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  if (!config.apiKey || !config.apiKey.trim()) {
    throw new Error('请先为所选供应商填写 API Key。');
  }
  const vendor = config.vendor;
  if (vendor === 'openai') {
    return callOpenAIChat(messages, config, extra, handlers, signal);
  }
  if (vendor === 'anthropic') {
    return callAnthropicMessages(messages, config, extra, handlers, signal);
  }
  if (vendor === 'gemini') {
    return callGemini(messages, config, extra, handlers, signal);
  }
  throw new Error(`暂不支持的供应商：${vendor}`);
}

const isAbortError = (error: any) =>
  error instanceof DOMException
    ? error.name === 'AbortError'
    : typeof error?.name === 'string' && error.name === 'AbortError';

const defaultBases: Record<ModelConfig['vendor'], string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

const tidyBase = (base?: string) => (base?.trim().replace(/\/$/, '') || '');

async function callOpenAIChat(
  messages: ChatMessage[],
  config: ModelConfig,
  extra?: ChatStreamExtra,
  handlers?: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  handlers?.onStatus?.('waiting_response');
  const base = tidyBase(config.baseUrl) || defaultBases.openai;
  const url = `${base}/chat/completions`;
  const body = {
    model: config.model,
    messages,
    temperature: extra?.temperature,
    top_p: config.top_p,
    max_tokens: extra?.maxTokens,
    stream: true,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  }).catch((error: any) => {
    handlers?.onStatus?.('done');
    if (isAbortError(error)) {
      throw error;
    }
    throw new Error(error?.message ?? '无法连接到 OpenAI');
  });

    if (!response.ok || !response.body) {
      handlers?.onStatus?.('done');
      if (response.status === 499 || response.status === 0) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const text = await response.text().catch(() => '');
      throw new Error(text || `OpenAI 请求失败（${response.status}）`);
    }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  let sawAnyChunk = false;
  handlers?.onStatus?.('thinking');

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const segments = buffer.split(/\n\n/);
      buffer = segments.pop() ?? '';
      for (const segment of segments) {
        const lines = segment.split(/\n/);
        for (const line of lines) {
          const match = line.match(/^data:\s*(.*)$/);
          if (!match) continue;
          const data = match[1];
          if (data === '[DONE]') {
            handlers?.onStatus?.('done');
            return full.trim();
          }
          if (!data) continue;
          try {
            const json = JSON.parse(data);
            const delta = json?.choices?.[0]?.delta || json?.choices?.[0]?.message || {};
            const token = delta?.content ?? '';
            if (token) {
              if (!sawAnyChunk) {
                handlers?.onStatus?.('responding');
                sawAnyChunk = true;
              }
              full += token;
              handlers?.onToken?.(token);
            }
          } catch {
            // ignore malformed chunk
          }
        }
      }
    }
  } finally {
    handlers?.onStatus?.('done');
  }

  return full.trim();
}

async function callAnthropicMessages(
  messages: ChatMessage[],
  config: ModelConfig,
  extra?: ChatStreamExtra,
  handlers?: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  handlers?.onStatus?.('waiting_response');
  handlers?.onStatus?.('thinking');
  const base = tidyBase(config.baseUrl) || defaultBases.anthropic;
  const url = `${base}/v1/messages`;
  const system = messages.filter((msg) => msg.role === 'system').map((msg) => msg.content).join('\n\n');
  const rest = messages.filter((msg) => msg.role !== 'system').map((msg) => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: [{ type: 'text', text: msg.content }],
  }));

  const body = {
    model: config.model,
    system,
    messages: rest,
    temperature: extra?.temperature ?? config.temperature,
    top_p: config.top_p,
    max_tokens: extra?.maxTokens ?? config.max_output_tokens ?? 4096,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': `${config.apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  }).catch((error: any) => {
    handlers?.onStatus?.('done');
    if (isAbortError(error)) {
      throw error;
    }
    throw new Error(error?.message ?? '无法连接到 Anthropic');
  });

  const json = await response.json().catch(() => null);
    handlers?.onStatus?.('done');
    if (!response.ok || !json) {
      if (response.status === 499 || response.status === 0) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const message = json?.error?.message || json?.message || `Anthropic 请求失败（${response.status}）`;
      throw new Error(message);
    }

  const content =
    json.content
      ?.map((part: { text?: string; content?: Array<{ text?: string }> }) => {
        if (typeof part?.text === 'string') return part.text;
        if (Array.isArray(part?.content)) {
          return part.content.map((chunk) => chunk.text ?? '').join('');
        }
        return '';
      })
      .join('')
      .trim() ?? '';
  return content;
}

async function callGemini(
  messages: ChatMessage[],
  config: ModelConfig,
  extra?: ChatStreamExtra,
  handlers?: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<string> {
  handlers?.onStatus?.('waiting_response');
  handlers?.onStatus?.('thinking');
  const base = tidyBase(config.baseUrl) || defaultBases.gemini;
  const url = `${base}/v1beta/models/${config.model}:generateContent?key=${encodeURIComponent(`${config.apiKey}`)}`;
  const contents = messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const body = {
    contents,
    generationConfig: {
      temperature: extra?.temperature ?? config.temperature,
      topP: config.top_p,
      maxOutputTokens: extra?.maxTokens ?? config.max_output_tokens,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }).catch((error: any) => {
    handlers?.onStatus?.('done');
    if (isAbortError(error)) {
      throw error;
    }
    throw new Error(error?.message ?? '无法连接到 Gemini');
  });

  const json = await response.json().catch(() => null);
    handlers?.onStatus?.('done');
    if (!response.ok || !json) {
      if (response.status === 499 || response.status === 0) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const message = json?.error?.message || json?.message || `Gemini 请求失败（${response.status}）`;
      throw new Error(message);
    }

  const content =
    json?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part?.text || '')
      .join('\n')
      .trim() ?? '';
  return content;
}
