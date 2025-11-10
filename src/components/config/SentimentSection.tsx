import type { ChangeEvent } from 'react';
import type { ModelConfig, Vendor } from '../../types';
import { useAppStore, type VendorDefaults } from '../../store/useAppStore';

export function SentimentSection() {
  const sentiment = useAppStore((state) => state.runState.config.sentiment);
  const vendorDefaults = useAppStore((state) => state.vendorDefaults);
  const updateSentiment = useAppStore((state) => state.updateSentiment);
  const setSentimentModelConfig = useAppStore((state) => state.setSentimentModelConfig);

  const handleToggle = (event: ChangeEvent<HTMLInputElement>) => {
    updateSentiment({ enabled: event.target.checked });
  };

  const handleModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    updateSentiment({ mode: event.target.value as 'byCount' | 'byList' });
  };

  const handleCountChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    updateSentiment({ count: Number.isNaN(value) ? undefined : Math.max(2, value) });
  };

  const handleLabelsChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const labels = event.target.value
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
    updateSentiment({ labels });
  };

  const handleUseCustomModel = (useCustom: boolean) => {
    if (!useCustom) {
      setSentimentModelConfig(null);
      return;
    }
    setSentimentModelConfig((current?: ModelConfig) => {
      if (current) return current;
      return {
        vendor: 'openai',
        model: vendorDefaults.openai.model ?? 'gpt-4.1-mini',
        apiKeyRef: vendorDefaults.openai.apiKeyRef,
        temperature: 0,
        top_p: 0.9,
        max_output_tokens: 512,
        baseUrl: vendorDefaults.openai.baseUrl,
      };
    });
  };

  const modelConfig = sentiment.modelConfigOverride;

  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2>情感分类</h2>
          <p className="card__subtitle">可选启用情感分类 Agent，为每条消息贴上标签。</p>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={sentiment.enabled} onChange={handleToggle} />
          <span>{sentiment.enabled ? '已启用' : '已关闭'}</span>
        </label>
      </header>
      {sentiment.enabled && (
        <div className="card__body column-gap">
          <div className="grid two-columns">
            <label className="form-field">
              <span>标签模式</span>
              <select value={sentiment.mode} onChange={handleModeChange}>
                <option value="byCount">指定标签数量（系统提供默认标签）</option>
                <option value="byList">自定义标签列表</option>
              </select>
            </label>
            {sentiment.mode === 'byCount' ? (
              <label className="form-field">
                <span>标签数量</span>
                <input
                  type="number"
                  min={2}
                  value={sentiment.count ?? 3}
                  onChange={handleCountChange}
                />
              </label>
            ) : (
              <label className="form-field">
                <span>自定义标签（逗号分隔）</span>
                <textarea
                  value={sentiment.labels?.join(', ') ?? ''}
                  placeholder="例如：高兴, 平静, 担忧, 愤怒, 悲伤"
                  onChange={handleLabelsChange}
                />
              </label>
            )}
          </div>
          <div className="sentiment-hint">
            {sentiment.mode === 'byCount' ? (
              <p className="form-hint">
                当数量为 3，将默认生成〔正向 / 中性 / 负向〕。数量为 5 时，默认生成〔高兴 / 平静 / 担忧 / 愤怒 / 悲伤〕。
              </p>
            ) : (
              <p className="form-hint">至少输入 2 个标签。系统会按顺序提示模型输出最匹配的标签。</p>
            )}
          </div>

          <div className="sentiment-model-panel">
            <div className="sentiment-model-header">
              <h3>分类模型</h3>
              <div>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => handleUseCustomModel(!modelConfig)}
                >
                  {modelConfig ? '使用统一配置' : '自定义模型'}
                </button>
              </div>
            </div>
            {modelConfig ? (
              <SentimentModelConfigEditor
                modelConfig={modelConfig}
                setModelConfig={setSentimentModelConfig}
                vendorDefaults={vendorDefaults}
              />
            ) : (
              <p className="form-hint">
                当前沿用统一配置（或自由配置下各 Agent 的模型）。如需独立分类模型，请点击“自定义模型”。
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SentimentModelConfigEditor({
  modelConfig,
  setModelConfig,
  vendorDefaults,
}: {
  modelConfig: ModelConfig;
  setModelConfig: (
    updater:
      | Partial<ModelConfig>
      | null
      | ((current?: ModelConfig) => ModelConfig | undefined),
  ) => void;
  vendorDefaults: VendorDefaults;
}) {
  const handleVendorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const vendor = event.target.value as Vendor;
    const defaults = vendorDefaults[vendor];
    setModelConfig({
      ...modelConfig,
      vendor,
      model: defaults.model ?? modelConfig.model,
      baseUrl: defaults.baseUrl ?? modelConfig.baseUrl,
      apiKeyRef: defaults.apiKeyRef,
    });
  };

  const handleApiKeyRefChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setModelConfig({
      ...modelConfig,
      apiKeyRef: event.target.value as ModelConfig['apiKeyRef'],
    });
  };

  const handleModelChange = (event: ChangeEvent<HTMLInputElement>) => {
    setModelConfig({
      ...modelConfig,
      model: event.target.value,
    });
  };

  const handleBaseUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    setModelConfig({
      ...modelConfig,
      baseUrl: event.target.value,
    });
  };

  const handleNumberChange =
    (key: 'temperature' | 'top_p' | 'max_output_tokens') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setModelConfig({
        ...modelConfig,
        [key]: value === '' ? undefined : Number(value),
      });
    };

  const handleSystemPromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setModelConfig({
      ...modelConfig,
      systemPromptExtra: event.target.value,
    });
  };

  const defaults = vendorDefaults[modelConfig.vendor];

  return (
    <div className="sentiment-model-fields">
      <div className="grid two-columns">
        <label className="form-field">
          <span>供应商</span>
          <select value={modelConfig.vendor} onChange={handleVendorChange}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Claude (Anthropic)</option>
            <option value="gemini">Gemini (Google)</option>
          </select>
        </label>
        <label className="form-field">
          <span>密钥来源</span>
          <select value={modelConfig.apiKeyRef} onChange={handleApiKeyRefChange}>
            <option value="memory">仅内存</option>
            <option value="localEncrypted">本地加密</option>
          </select>
        </label>
        <label className="form-field">
          <span>模型名称</span>
          <input
            type="text"
            value={modelConfig.model}
            placeholder={defaults.model ?? ''}
            onChange={handleModelChange}
          />
        </label>
        <label className="form-field">
          <span>Base URL（可选）</span>
          <input
            type="url"
            value={modelConfig.baseUrl ?? ''}
            placeholder={defaults.baseUrl ?? 'https://...'}
            onChange={handleBaseUrlChange}
          />
        </label>
        <label className="form-field">
          <span>Temperature</span>
          <input
            type="number"
            step="0.05"
            min={0}
            max={2}
            value={modelConfig.temperature ?? ''}
            placeholder="0"
            onChange={handleNumberChange('temperature')}
          />
        </label>
        <label className="form-field">
          <span>Top-p</span>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={modelConfig.top_p ?? ''}
            placeholder="0.9"
            onChange={handleNumberChange('top_p')}
          />
        </label>
        <label className="form-field">
          <span>最大输出 Tokens</span>
          <input
            type="number"
            min={16}
            value={modelConfig.max_output_tokens ?? ''}
            placeholder="512"
            onChange={handleNumberChange('max_output_tokens')}
          />
        </label>
      </div>
      <label className="form-field">
        <span>额外系统提示（可选）</span>
        <textarea
          value={modelConfig.systemPromptExtra ?? ''}
          placeholder="可注明分类维度、标签语义或输出格式要求。"
          onChange={handleSystemPromptChange}
        />
      </label>
    </div>
  );
}
