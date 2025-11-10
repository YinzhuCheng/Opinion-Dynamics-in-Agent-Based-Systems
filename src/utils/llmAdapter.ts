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

export async function chatStream(
  messages: ChatMessage[],
  config: ModelConfig,
  extra?: ChatStreamExtra,
  handlers?: ChatStreamHandlers,
): Promise<string> {
  const apiBase = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';
  const endpoint = apiBase ? `${apiBase}/api/llm` : '/api/llm';
  handlers?.onStatus?.('waiting_response');

  const stream = extra?.stream ?? true;

  let response: Response;
  try {
    const body = {
      vendor: config.vendor,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages,
      temperature: extra?.temperature,
      max_output_tokens: extra?.maxTokens,
      stream,
    } as Record<string, unknown>;

    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (error: any) {
    handlers?.onStatus?.('done');
    throw new Error(error?.message ?? '无法连接到 LLM 服务');
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    handlers?.onStatus?.('done');
    try {
      const parsed = rawText ? JSON.parse(rawText) : undefined;
      const message =
        parsed?.error?.message || parsed?.message || `LLM 请求失败（${response.status}）`;
      throw new Error(message);
    } catch {
      throw new Error(rawText || `LLM 请求失败（${response.status}）`);
    }
  }

  const contentType = response.headers.get('content-type') || '';
  if (!response.body) {
    const text = await response.text().catch(() => '');
    handlers?.onStatus?.('done');
    return text.trim();
  }

  if (contentType.includes('text/event-stream')) {
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

  // 非流式返回，尝试解析 JSON
  const rawText = await response.text().catch(() => '');
  handlers?.onStatus?.('done');
  if (!rawText) return '';

  try {
    const parsed = JSON.parse(rawText);
    const content =
      parsed?.choices?.[0]?.message?.content ??
      parsed?.content ??
      parsed?.choices?.[0]?.delta?.content ??
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
