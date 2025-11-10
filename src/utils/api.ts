import type { ModelConfig, Vendor } from '../types';

export interface UnifiedLLMRequest {
  vendor: Vendor;
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
}

export interface UnifiedLLMResponse {
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

export interface ConnectionTestPayload {
  vendor: Vendor;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const jsonHeaders = {
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

const handleResponse = async (resp: Response) => {
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `请求失败（${resp.status}）`);
  }
  return (await resp.json()) as UnifiedLLMResponse;
};

export const callLLM = async (payload: UnifiedLLMRequest): Promise<UnifiedLLMResponse> => {
  const response = await fetch('/api/llm', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify(payload),
  });
  return handleResponse(response);
};

export const testVendorConnection = async ({
  vendor,
  apiKey,
  baseUrl,
  model,
}: ConnectionTestPayload): Promise<UnifiedLLMResponse> => {
  const response = await fetch('/api/llm/test', {
    method: 'POST',
    headers: jsonHeaders,
    body: JSON.stringify({
      vendor,
      apiKey,
      baseUrl,
      model,
    }),
  });
  return handleResponse(response);
};

export const buildRequestFromConfig = (
  config: ModelConfig,
  apiKey: string,
  messages: UnifiedLLMRequest['messages'],
): UnifiedLLMRequest => ({
  vendor: config.vendor,
  baseUrl: config.baseUrl,
  apiKey,
  model: config.model,
  temperature: config.temperature,
  top_p: config.top_p,
  max_output_tokens: config.max_output_tokens,
  response_format: 'text',
  messages,
});
