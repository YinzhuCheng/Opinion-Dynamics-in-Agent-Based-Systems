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
  stream?: boolean;
}

const OPENAI_BASE = 'https://api.openai.com/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

export async function chatStream(
  messages: ChatMessage[],
  config: ModelConfig,
  extra?: ChatStreamExtra,
  handlers?: ChatStreamHandlers,
): Promise<string> {
  handlers?.onStatus?.('waiting_response');

  try {
    switch (config.vendor) {
      case 'anthropic':
        return await callAnthropic(messages, config, extra, handlers);
      case 'gemini':
        return await callGemini(messages, config, extra, handlers);
      case 'openai':
      default:
        return await callOpenAI(messages, config, extra, handlers);
    }
  } catch (error: any) {
    handlers?.onStatus?.('done');
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(error?.message ?? 'LLM 请求失败');
  }
}

async function callOpenAI(
  messages: ChatMessage[],
  config: ModelConfig,
  extra: ChatStreamExtra | undefined,
  handlers?: ChatStreamHandlers,
): Promise<string> {
  const stream = extra?.stream ?? true;
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error('缺少 OpenAI API Key');
  }

  const base = (config.baseUrl?.trim() || OPENAI_BASE).replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const temperature = extra?.temperature ?? config.temperature;
  const topP = config.top_p;
  const maxTokens = extra?.maxTokens ?? config.max_output_tokens;

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream,
  };
  if (typeof temperature === 'number') body.temperature = temperature;
  if (typeof topP === 'number') body.top_p = topP;
  if (typeof maxTokens === 'number') body.max_tokens = maxTokens;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    Accept: stream ? 'text/event-stream' : 'application/json',
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch (error: any) {
    throw new Error(error?.message ?? '无法连接到 OpenAI 接口');
  }

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, 'OpenAI'));
  }

  if (stream) {
    return await readEventStream(response, handlers);
  }

  handlers?.onStatus?.('thinking');
  const rawText = await response.text().catch(() => '');
  if (rawText) {
    handlers?.onStatus?.('responding');
  }
  handlers?.onStatus?.('done');

  if (!rawText) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawText);
    const content =
      parsed?.choices?.[0]?.message?.content ??
      parsed?.choices?.[0]?.delta?.content ??
      parsed?.content ??
      '';
    if (content) {
      return content.toString().trim();
    }
    if (parsed?.error?.message) {
      throw new Error(parsed.error.message);
    }
    return rawText.trim();
  } catch {
    return rawText.trim();
  }
}

async function callAnthropic(
  messages: ChatMessage[],
  config: ModelConfig,
  extra: ChatStreamExtra | undefined,
  handlers?: ChatStreamHandlers,
): Promise<string> {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error('缺少 Anthropic API Key');
  }

  const base = (config.baseUrl?.trim() || ANTHROPIC_BASE).replace(/\/$/, '');
  const url = `${base}/v1/messages`;
  const temperature = extra?.temperature ?? config.temperature;
  const topP = config.top_p;
  const maxTokens = extra?.maxTokens ?? config.max_output_tokens ?? 4096;

  const systemPrompt = messages
    .filter((msg) => msg.role === 'system')
    .map((msg) => msg.content)
    .join('\n\n')
    .trim();

  const body = cleanUndefined({
    model: config.model,
    system: systemPrompt || undefined,
    messages: messages
      .filter((msg) => msg.role !== 'system')
      .map((msg) => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: msg.content }],
      })),
    temperature,
    top_p: topP,
    max_tokens: maxTokens,
  });

  handlers?.onStatus?.('thinking');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
  } catch (error: any) {
    throw new Error(error?.message ?? '无法连接到 Anthropic 接口');
  }

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, 'Anthropic'));
  }

  const rawText = await response.text().catch(() => '');
  if (rawText) {
    handlers?.onStatus?.('responding');
  }
  handlers?.onStatus?.('done');

  if (!rawText) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawText);
    const content = parsed?.content?.[0]?.text ?? '';
    if (content) {
      return content.toString().trim();
    }
    if (parsed?.error?.message) {
      throw new Error(parsed.error.message);
    }
    return rawText.trim();
  } catch {
    return rawText.trim();
  }
}

async function callGemini(
  messages: ChatMessage[],
  config: ModelConfig,
  extra: ChatStreamExtra | undefined,
  handlers?: ChatStreamHandlers,
): Promise<string> {
  const apiKey = config.apiKey?.trim();
  if (!apiKey) {
    throw new Error('缺少 Gemini API Key');
  }

  const base = (config.baseUrl?.trim() || GEMINI_BASE).replace(/\/$/, '');
  const url = `${base}/v1beta/models/${config.model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const temperature = extra?.temperature ?? config.temperature;
  const topP = config.top_p;
  const maxTokens = extra?.maxTokens ?? config.max_output_tokens;

  const generationConfig = cleanUndefined({
    temperature,
    topP,
    maxOutputTokens: maxTokens,
  });

  const body: Record<string, unknown> = {
    contents: messages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    })),
  };
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }

  handlers?.onStatus?.('thinking');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error: any) {
    throw new Error(error?.message ?? '无法连接到 Gemini 接口');
  }

  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, 'Gemini'));
  }

  const rawText = await response.text().catch(() => '');
  if (rawText) {
    handlers?.onStatus?.('responding');
  }
  handlers?.onStatus?.('done');

  if (!rawText) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawText);
    const content =
      parsed?.candidates?.[0]?.content?.parts
        ?.map((part: { text?: string }) => part.text ?? '')
        .join('\n') ?? '';
    if (content) {
      return content.toString().trim();
    }
    if (parsed?.error?.message) {
      throw new Error(parsed.error.message);
    }
    return rawText.trim();
  } catch {
    return rawText.trim();
  }
}

async function readEventStream(response: Response, handlers?: ChatStreamHandlers): Promise<string> {
  if (!response.body) {
    const text = await response.text().catch(() => '');
    handlers?.onStatus?.('done');
    return text.trim();
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
            // 忽略非 JSON 分片
          }
        }
      }
    }
  } finally {
    handlers?.onStatus?.('done');
  }

  return full.trim();
}

async function extractErrorMessage(response: Response, vendorLabel: string): Promise<string> {
  const status = response.status;
  const text = await response.text().catch(() => '');
  if (!text) {
    return `${vendorLabel} 请求失败（${status}）`;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed?.error?.message || parsed?.message || text || `${vendorLabel} 请求失败（${status}）`;
  } catch {
    return text || `${vendorLabel} 请求失败（${status}）`;
  }
}

function cleanUndefined<T extends Record<string, any>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined || obj[key] === null) {
      delete obj[key];
    }
  }
  return obj;
}
