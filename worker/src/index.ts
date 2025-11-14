interface UnifiedRequest {
  vendor: 'openai' | 'anthropic' | 'gemini';
  baseUrl?: string;
  apiKey: string;
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  top_p?: number;
  max_output_tokens?: number;
  response_format?: 'text' | 'json';
  requestId?: string;
  metadata?: Record<string, unknown>;
  stream?: boolean;
}

interface UnifiedResponse {
  ok: boolean;
  content?: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

const DEFAULT_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'OPTIONS, POST',
  'Access-Control-Allow-Headers': '*',
};

const OPENAI_BASE = 'https://api.openai.com/v1';
const ANTHROPIC_BASE = 'https://api.anthropic.com';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: DEFAULT_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Only POST is supported' } }, 405);
    }

    const url = new URL(request.url);

      if (url.pathname === '/api/llm' || url.pathname === '/api/llm/') {
        return this.handleLLMRequest(request);
      }

    if (url.pathname === '/api/llm/test') {
      return this.handleTestRequest(request);
    }

    return json({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404);
  },

    async handleLLMRequest(request: Request): Promise<Response> {
      try {
        const payload = await this.parseRequest(request);
        if (!payload) {
          return json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid JSON payload' } }, 400);
        }

        if (payload.stream && payload.vendor === 'openai') {
          try {
            return await proxyOpenAIStream(payload);
          } catch (error: unknown) {
            const info = toErrorLike(error);
            return json(
              {
                ok: false,
                error: {
                  code: info.code ?? 'UPSTREAM_ERROR',
                  message: info.message ?? 'Unknown error',
                  details: sanitizeError(error),
                },
              },
              typeof info.status === 'number' ? info.status : 500,
            );
          }
        }

        const result = await withRetries(() => callVendor(payload), 3);
        return json(result);
      } catch (error: unknown) {
        const info = toErrorLike(error);
        return json(
          {
            ok: false,
            error: {
              code: info.code ?? 'UPSTREAM_ERROR',
              message: info.message ?? 'Unknown error',
              details: sanitizeError(error),
            },
          },
          typeof info.status === 'number' ? info.status : 500,
        );
      }
    },

    async handleTestRequest(request: Request): Promise<Response> {
      try {
        const payload = await this.parseRequest(request);
        if (!payload) {
          return json({ ok: false, error: { code: 'INVALID_REQUEST', message: 'Invalid JSON payload' } }, 400);
        }
        const testPayload: UnifiedRequest = {
          ...payload,
          messages:
            payload.messages && payload.messages.length > 0
              ? payload.messages
              : [
                  { role: 'system', content: 'You are a connectivity probe. Reply with the word "pong".' },
                  { role: 'user', content: 'ping' },
                ],
          temperature: payload.temperature ?? 0,
          max_output_tokens: Math.min(payload.max_output_tokens ?? 32, 64),
          stream: false,
        };
        const result = await withRetries(() => callVendor(testPayload), 2);
        return json(result);
      } catch (error: unknown) {
        const info = toErrorLike(error);
        return json(
          {
            ok: false,
            error: {
              code: info.code ?? 'UPSTREAM_ERROR',
              message: info.message ?? 'Unknown error',
              details: sanitizeError(error),
            },
          },
          typeof info.status === 'number' ? info.status : 500,
        );
      }
    },

  async parseRequest(request: Request): Promise<UnifiedRequest | null> {
    try {
      const text = await request.text();
      if (!text) return null;
      return JSON.parse(text) as UnifiedRequest;
    } catch {
      return null;
    }
  },
};

async function proxyOpenAIStream(payload: UnifiedRequest): Promise<Response> {
  const base = (payload.baseUrl || OPENAI_BASE).replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model: payload.model,
    messages: payload.messages,
    temperature: payload.temperature,
    top_p: payload.top_p,
    max_tokens: payload.max_output_tokens,
    stream: true,
  };

  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${payload.apiKey}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok || !upstream.body) {
    const errBody = await safeJson(upstream);
    throw normalizeError('openai', upstream.status, errBody);
  }

  const { readable, writable } = new TransformStream();
  upstream.body
    .pipeTo(writable)
    .catch((error) => console.warn('[OpenAI stream] pipe error', error));

  const headers = new Headers({
    ...DEFAULT_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  return new Response(readable, {
    status: 200,
    headers,
  });
}

async function callVendor(payload: UnifiedRequest): Promise<UnifiedResponse> {
  switch (payload.vendor) {
    case 'openai':
      return callOpenAI(payload);
    case 'anthropic':
      return callAnthropic(payload);
    case 'gemini':
      return callGemini(payload);
    default:
      return {
        ok: false,
        error: {
          code: 'INVALID_VENDOR',
          message: `Unsupported vendor: ${payload.vendor}`,
        },
      };
  }
}

async function callOpenAI(payload: UnifiedRequest): Promise<UnifiedResponse> {
  const base = (payload.baseUrl || OPENAI_BASE).replace(/\/$/, '');
  const url = `${base}/chat/completions`;
  const body = {
    model: payload.model,
    messages: payload.messages,
    temperature: payload.temperature,
    top_p: payload.top_p,
    max_tokens: payload.max_output_tokens,
    response_format: payload.response_format === 'json' ? { type: 'json_object' } : undefined,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${payload.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  const jsonBody = await safeJson(response);
  if (!response.ok) {
    throw normalizeError('openai', response.status, jsonBody);
  }

  const content = jsonBody?.choices?.[0]?.message?.content ?? '';
  return {
    ok: true,
    content,
    usage: jsonBody?.usage,
  };
}

async function callAnthropic(payload: UnifiedRequest): Promise<UnifiedResponse> {
  const base = (payload.baseUrl || ANTHROPIC_BASE).replace(/\/$/, '');
  const url = `${base}/v1/messages`;
  const systemMessages = payload.messages.filter((msg) => msg.role === 'system');
  const nonSystemMessages = payload.messages.filter((msg) => msg.role !== 'system');

  const body = {
    model: payload.model,
    system: systemMessages.map((msg) => msg.content).join('\n\n'),
    messages: nonSystemMessages.map((msg) => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: msg.content }],
    })),
    temperature: payload.temperature,
    top_p: payload.top_p,
    max_tokens: payload.max_output_tokens ?? 4096,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': payload.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  const jsonBody = await safeJson(response);
  if (!response.ok) {
    throw normalizeError('anthropic', response.status, jsonBody);
  }

  const content = jsonBody?.content?.[0]?.text ?? '';
  return {
    ok: true,
    content,
    usage: jsonBody?.usage,
  };
}

async function callGemini(payload: UnifiedRequest): Promise<UnifiedResponse> {
  const base = payload.baseUrl || GEMINI_BASE;
  const url = `${base.replace(/\/$/, '')}/v1beta/models/${payload.model}:generateContent?key=${encodeURIComponent(payload.apiKey)}`;

  const contents = payload.messages.map((msg) => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  const body = {
    contents,
    generationConfig: {
      temperature: payload.temperature,
      topP: payload.top_p,
      maxOutputTokens: payload.max_output_tokens,
    },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const jsonBody = await safeJson(response);
  if (!response.ok) {
    throw normalizeError('gemini', response.status, jsonBody);
  }

  const content =
    jsonBody?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('\n') ?? '';

  return {
    ok: true,
    content,
    usage: jsonBody?.usageMetadata && {
      prompt_tokens: jsonBody.usageMetadata.promptTokenCount,
      completion_tokens: jsonBody.usageMetadata.candidatesTokenCount,
      total_tokens: jsonBody.usageMetadata.totalTokenCount,
    },
  };
}

function json(data: UnifiedResponse, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...DEFAULT_HEADERS,
      'Content-Type': 'application/json',
    },
  });
}

type ErrorLike = {
  code?: string;
  message?: string;
  status?: number;
  httpStatus?: number;
  details?: unknown;
};

const toErrorLike = (error: unknown): ErrorLike =>
  typeof error === 'object' && error !== null ? (error as ErrorLike) : {};

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function withRetries<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt < maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= maxRetries || isFatalError(error)) {
        throw error;
      }
      await delay(2 ** (attempt - 1) * 500);
    }
  }
  throw lastError;
}

const isFatalError = (error: unknown) => {
  const info = toErrorLike(error);
  const status = info.status ?? info.httpStatus;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeError(vendor: string, status: number, body: unknown) {
  const structuredBody =
    typeof body === 'object' && body !== null
      ? (body as { error?: { message?: string }; message?: string })
      : undefined;
  const code = mapErrorCode(status);
  const message =
    structuredBody?.error?.message ||
    structuredBody?.message ||
    `Upstream ${vendor} request failed with status ${status}`;
  const error = new Error(message) as Error & ErrorLike;
  error.code = code;
  error.status = status;
  error.details = body;
  return error;
}

function mapErrorCode(status: number): string {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'UPSTREAM_ERROR';
  return 'INVALID_REQUEST';
}

function sanitizeError(error: unknown) {
  const info = toErrorLike(error);
  if (!info.code && !info.status && info.details === undefined) {
    return undefined;
  }
  return { status: info.status ?? info.httpStatus, code: info.code, details: info.details };
}
