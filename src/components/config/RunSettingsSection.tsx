import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { DialogueMode, ModelConfig, Vendor } from '../../types';
import { useAppStore, type VendorDefaults } from '../../store/useAppStore';
import { chatStream } from '../../utils/llmAdapter';

const modeOptions: Array<{ value: DialogueMode; label: string; description: string }> = [
  { value: 'round_robin', label: '轮询对话', description: '严格按 Agent 顺序轮流发言，适合结构化讨论。' },
  { value: 'free', label: '自由对话', description: 'Agent 自由决定是否发言，节奏更灵活。' },
];

const vendorLabels: Record<Vendor, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude (Anthropic)',
  gemini: 'Gemini (Google)',
};

const vendorPlaceholders: Record<Vendor, { baseUrl: string; model: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-3-5-sonnet-latest',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-1.5-pro',
  },
};

type TestState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
};

export function RunSettingsSection() {
  const [collapsed, setCollapsed] = useState(false);
  const [showGlobalKey, setShowGlobalKey] = useState(false);
  const [testMessage, setTestMessage] = useState('请用一句话介绍你自己。');
  const [testState, setTestState] = useState<TestState>({ status: 'idle' });

  const runConfig = useAppStore((state) => state.runState.config);
  const vendorDefaults = useAppStore((state) => state.vendorDefaults);
  const setVendorBaseUrl = useAppStore((state) => state.setVendorBaseUrl);
  const setVendorModel = useAppStore((state) => state.setVendorModel);
  const setVendorApiKey = useAppStore((state) => state.setVendorApiKey);
  const setRunMode = useAppStore((state) => state.setRunMode);
  const setMaxRounds = useAppStore((state) => state.setMaxRounds);
  const setMaxMessages = useAppStore((state) => state.setMaxMessages);
  const setUseGlobalModelConfig = useAppStore((state) => state.setUseGlobalModelConfig);
  const updateGlobalModelConfig = useAppStore((state) => state.updateGlobalModelConfig);
  const sentiment = useAppStore((state) => state.runState.config.sentiment);
  const updateSentiment = useAppStore((state) => state.updateSentiment);
  const setSentimentModelConfig = useAppStore((state) => state.setSentimentModelConfig);
  const visualization = useAppStore((state) => state.runState.config.visualization);
  const updateRunConfig = useAppStore((state) => state.updateRunConfig);

  const handleModeChange = (event: ChangeEvent<HTMLInputElement>) => {
    setRunMode(event.target.value as DialogueMode);
  };

  const handleMaxRoundsChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setMaxRounds(value ? Number(value) : undefined);
  };

  const handleMaxMessagesChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setMaxMessages(value ? Number(value) : undefined);
  };

  const handleVendorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const vendor = event.target.value as Vendor;
    const defaults = vendorDefaults[vendor];
    updateGlobalModelConfig(() => ({
      vendor,
      baseUrl: defaults.baseUrl ?? '',
      apiKey: defaults.apiKey ?? '',
      model: defaults.model ?? vendorPlaceholders[vendor].model,
      systemPromptExtra: '',
    }));
    setShowGlobalKey(false);
    setTestState({ status: 'idle' });
  };

  const handleGlobalModelChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    updateGlobalModelConfig({ model: value });
    setVendorModel(selectedVendor, value);
    setTestState({ status: 'idle' });
  };

  const handleGlobalBaseUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    updateGlobalModelConfig({ baseUrl: value });
    setVendorBaseUrl(selectedVendor, value);
    setTestState({ status: 'idle' });
  };

  const handleGlobalApiKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    updateGlobalModelConfig({ apiKey: value });
    setVendorApiKey(selectedVendor, value);
    setTestState({ status: 'idle' });
  };

  const handleGlobalNumberChange =
    (key: 'temperature' | 'top_p' | 'max_output_tokens') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      updateGlobalModelConfig({
        [key]: value === '' ? undefined : Number(value),
      } as Partial<ModelConfig>);
      setTestState({ status: 'idle' });
    };

  const handleSystemPromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    updateGlobalModelConfig({ systemPromptExtra: event.target.value });
    setTestState({ status: 'idle' });
  };

  const handleTestMessageChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setTestMessage(event.target.value);
    setTestState({ status: 'idle' });
  };

  const handleSentimentToggle = (event: ChangeEvent<HTMLInputElement>) => {
    updateSentiment({ enabled: event.target.checked });
  };

  const handleSentimentModeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    updateSentiment({ mode: event.target.value as 'byCount' | 'byList' });
  };

  const handleSentimentCountChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    updateSentiment({ count: Number.isNaN(value) ? undefined : Math.max(2, value) });
  };

  const handleSentimentLabelsChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const labels = event.target.value
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean);
    updateSentiment({ labels });
  };

  const handleSentimentUseCustomModel = (useCustom: boolean) => {
    if (!useCustom) {
      setSentimentModelConfig(null);
      return;
    }
    setSentimentModelConfig((current?: ModelConfig) => {
      if (current) return current;
      return {
        vendor: 'openai',
        model: vendorDefaults.openai.model ?? 'gpt-4.1-mini',
        apiKey: vendorDefaults.openai.apiKey ?? '',
        baseUrl: vendorDefaults.openai.baseUrl,
      };
    });
  };

  const handleVisualizationToggle = (event: ChangeEvent<HTMLInputElement>) => {
    updateRunConfig((config) => ({
      ...config,
      visualization: {
        ...config.visualization,
        enableStanceChart: event.target.checked,
      },
    }));
  };

  const handleGlobalTestConnection = async (vendor: Vendor, config: ModelConfig) => {
    const apiKey = config.apiKey?.trim();
    if (!apiKey) {
      setTestState({ status: 'error', message: '请先填写 API Key。' });
      return;
    }

    const resolvedConfig: ModelConfig = {
      ...config,
      baseUrl:
        config.baseUrl?.trim() ||
        vendorDefaults[vendor]?.baseUrl ||
        vendorPlaceholders[vendor].baseUrl,
      model:
        config.model?.trim() ||
        vendorDefaults[vendor]?.model ||
        vendorPlaceholders[vendor].model,
      apiKey,
    };

    setTestState({ status: 'loading' });
    try {
      const result = await chatStream(
        [
          {
            role: 'system',
            content: '你是连通性测试助手，请用简洁中文回答用户输入，以确认接口稳定可用。',
          },
          {
            role: 'user',
            content: testMessage || '请确认你已收到这条测试指令。',
          },
        ],
        resolvedConfig,
        {
          temperature: resolvedConfig.temperature,
          maxTokens: resolvedConfig.max_output_tokens,
          stream: false,
          topP: resolvedConfig.top_p,
        },
      );
      setTestState({
        status: 'success',
        message: result || '（请求成功但未返回正文）',
      });
    } catch (error: any) {
      setTestState({
        status: 'error',
        message: error?.message ?? '请求失败，请稍后再试。',
      });
    }
  };

  const selectedVendor = runConfig.globalModelConfig?.vendor ?? 'openai';
  const vendorDefault = vendorDefaults[selectedVendor];
  const globalConfig = runConfig.globalModelConfig ?? {
    vendor: selectedVendor,
    baseUrl: vendorDefault.baseUrl ?? '',
    apiKey: vendorDefault.apiKey ?? '',
    model: vendorDefault.model ?? vendorPlaceholders[selectedVendor].model,
    systemPromptExtra: '',
  };
  const sentimentModelConfig = sentiment.modelConfigOverride;

  const handleClearGlobalApiKey = () => {
    updateGlobalModelConfig({ apiKey: '' });
    setVendorApiKey(selectedVendor, '');
    setTestState({ status: 'idle' });
  };

  return (
    <section className={`card ${collapsed ? 'card--collapsed' : ''}`}>
      <header className="card__header">
        <div>
          <h2>对话编排设置</h2>
          <p className="card__subtitle">配置供应商密钥、全局模型参数，以及对话模式等核心规则。</p>
        </div>
        <div className="card__actions">
          <button
            type="button"
            className="card__toggle"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={!collapsed}
          >
            {collapsed ? '展开' : '收起'}
          </button>
        </div>
      </header>

      <div className="card__body column-gap">
        <div className="card-section">
          <h3 className="card-section-title">对话模式与全局模型</h3>
          <div className="mode-selector">
            {modeOptions.map((option) => (
              <label key={option.value} className={`mode-selector__item ${runConfig.mode === option.value ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="dialogue-mode"
                  value={option.value}
                  checked={runConfig.mode === option.value}
                  onChange={handleModeChange}
                />
                <div>
                  <strong>{option.label}</strong>
                  <p>{option.description}</p>
                </div>
              </label>
            ))}
          </div>

          <div className="grid two-columns">
            {runConfig.mode === 'round_robin' ? (
              <label className="form-field">
                <span>最大轮数</span>
                <input
                  type="number"
                  min={1}
                  value={runConfig.maxRounds ?? ''}
                  placeholder="例如 6"
                  onChange={handleMaxRoundsChange}
                />
              </label>
            ) : (
              <label className="form-field">
                <span>最大消息数</span>
                <input
                  type="number"
                  min={1}
                  value={runConfig.maxMessages ?? ''}
                  placeholder="例如 20"
                  onChange={handleMaxMessagesChange}
                />
              </label>
            )}
            <label className="form-field">
              <span>模型配置模式</span>
              <select
                value={runConfig.useGlobalModelConfig ? 'global' : 'perAgent'}
                onChange={(event) => setUseGlobalModelConfig(event.target.value === 'global')}
              >
                <option value="global">统一配置（所有 Agent 共用）</option>
                <option value="perAgent">自由配置（每个 Agent 独立）</option>
              </select>
            </label>
          </div>

          {runConfig.useGlobalModelConfig && (
            <div className="global-model-card">
              <div className="global-model-card__header">
                <h4>统一模型配置</h4>
                <p className="form-hint">
                  当前使用 {vendorLabels[selectedVendor]}。
                </p>
              </div>
              <div className="grid two-columns">
                <label className="form-field">
                  <span>供应商</span>
                  <select value={selectedVendor} onChange={handleVendorChange}>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Claude (Anthropic)</option>
                    <option value="gemini">Gemini (Google)</option>
                  </select>
                </label>
                <label className="form-field">
                  <span>API Key</span>
                  <div className="form-field__input-with-action">
                    <input
                      type={showGlobalKey ? 'text' : 'password'}
                      value={globalConfig.apiKey ?? ''}
                      onChange={handleGlobalApiKeyChange}
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      className="button tertiary"
                      onClick={() => setShowGlobalKey((prev) => !prev)}
                    >
                      {showGlobalKey ? '隐藏' : '显示'}
                    </button>
                  </div>
                </label>
                <label className="form-field">
                  <span>模型名称</span>
                  <input
                    type="text"
                    value={globalConfig.model ?? vendorDefault.model ?? ''}
                    placeholder={vendorDefault.model ?? ''}
                    onChange={handleGlobalModelChange}
                  />
                </label>
                <label className="form-field">
                  <span>Base URL（可选）</span>
                  <input
                    type="url"
                    value={globalConfig.baseUrl ?? vendorDefault.baseUrl ?? ''}
                    placeholder={vendorDefault.baseUrl ?? 'https://...'}
                    onChange={handleGlobalBaseUrlChange}
                  />
                </label>
                <label className="form-field">
                  <span>Temperature</span>
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={2}
                    value={globalConfig.temperature ?? ''}
                    placeholder="0.7"
                    onChange={handleGlobalNumberChange('temperature')}
                  />
                </label>
                <label className="form-field">
                  <span>Top-p</span>
                  <input
                    type="number"
                    step="0.05"
                    min={0}
                    max={1}
                    value={globalConfig.top_p ?? ''}
                    placeholder="0.95"
                    onChange={handleGlobalNumberChange('top_p')}
                  />
                </label>
                <label className="form-field">
                  <span>最大输出 Tokens</span>
                  <input
                    type="number"
                    min={16}
                    value={globalConfig.max_output_tokens ?? ''}
                    placeholder="留空表示无限制"
                    onChange={handleGlobalNumberChange('max_output_tokens')}
                  />
                </label>
              </div>
              <label className="form-field">
                <span>额外系统提示（可选）</span>
                <textarea
                  value={globalConfig.systemPromptExtra ?? ''}
                  placeholder="可补充统一的系统提示，例如讨论目标、语言要求等。"
                  onChange={handleSystemPromptChange}
                />
              </label>
                <label className="form-field">
                  <span>连通性测试输入</span>
                  <textarea
                    value={testMessage}
                    onChange={handleTestMessageChange}
                    placeholder="例如：请用一句话介绍你自己，并说明当前时间。"
                  />
                </label>
                <div className="vendor-card__actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => handleGlobalTestConnection(selectedVendor, globalConfig)}
                    disabled={testState.status === 'loading'}
                  >
                    {testState.status === 'loading' ? '测试中…' : '测试连通'}
                  </button>
                  <button type="button" className="button ghost" onClick={handleClearGlobalApiKey}>
                    清空密钥
                  </button>
                </div>
                {testState.status === 'success' && (
                  <pre className="vendor-test-result success">{testState.message}</pre>
                )}
                {testState.status === 'error' && (
                  <pre className="vendor-test-result error">{testState.message}</pre>
                )}
            </div>
          )}
          </div>
          <div className="card-section">
            <h3 className="card-section-title">情感分类</h3>
            <label className="toggle">
              <input type="checkbox" checked={sentiment.enabled} onChange={handleSentimentToggle} />
              <span>{sentiment.enabled ? '已启用' : '已关闭'}</span>
            </label>
            <p className="form-hint">为对话消息附加情感标签，可选择默认模板或自定义列表。</p>
            {sentiment.enabled && (
              <>
                <div className="grid two-columns">
                  <label className="form-field">
                    <span>标签模式</span>
                    <select value={sentiment.mode} onChange={handleSentimentModeChange}>
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
                        onChange={handleSentimentCountChange}
                      />
                    </label>
                  ) : (
                    <label className="form-field">
                      <span>自定义标签（逗号分隔）</span>
                      <textarea
                        value={sentiment.labels?.join(', ') ?? ''}
                        placeholder="例如：高兴, 平静, 担忧, 愤怒, 悲伤"
                        onChange={handleSentimentLabelsChange}
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
                        onClick={() => handleSentimentUseCustomModel(!sentimentModelConfig)}
                      >
                        {sentimentModelConfig ? '使用统一配置' : '自定义模型'}
                      </button>
                    </div>
                  </div>
                  {sentimentModelConfig ? (
                    <SentimentModelConfigEditor
                      modelConfig={sentimentModelConfig}
                      setModelConfig={setSentimentModelConfig}
                      vendorDefaults={vendorDefaults}
                    />
                  ) : (
                    <p className="form-hint">
                      当前沿用统一配置（或自由配置下各 Agent 的模型）。如需独立分类模型，请点击“自定义模型”。
                    </p>
                  )}
                </div>
              </>
            )}
            <label className="form-field checkbox-field">
              <span>启用观点演化曲线</span>
              <div className="checkbox-description">
                <input
                  type="checkbox"
                  checked={visualization.enableStanceChart}
                  onChange={handleVisualizationToggle}
                />
                <p className="form-hint">勾选后将在结果页生成立场折线图，可导出 PNG / SVG。</p>
              </div>
            </label>
        </div>
      </div>
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
  const [testState, setTestState] = useState<TestState>({ status: 'idle' });
  const [testMessage, setTestMessage] = useState('请判断“今天真让人开心！”的情绪。');

  const handleVendorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const vendor = event.target.value as Vendor;
    const defaults = vendorDefaults[vendor];
    setModelConfig({
      ...modelConfig,
      vendor,
      model: defaults.model ?? modelConfig.model,
      baseUrl: defaults.baseUrl ?? modelConfig.baseUrl,
      apiKey: defaults.apiKey ?? modelConfig.apiKey ?? '',
    });
    setTestState({ status: 'idle' });
  };

  const handleApiKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    setModelConfig({
      ...modelConfig,
      apiKey: event.target.value,
    });
    setTestState({ status: 'idle' });
  };

  const handleModelChange = (event: ChangeEvent<HTMLInputElement>) => {
    setModelConfig({
      ...modelConfig,
      model: event.target.value,
    });
    setTestState({ status: 'idle' });
  };

  const handleBaseUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    setModelConfig({
      ...modelConfig,
      baseUrl: event.target.value,
    });
    setTestState({ status: 'idle' });
  };

  const handleNumberChange =
    (key: 'temperature' | 'top_p' | 'max_output_tokens') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setModelConfig({
        ...modelConfig,
        [key]: value === '' ? undefined : Number(value),
      });
      setTestState({ status: 'idle' });
    };

  const handleSystemPromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setModelConfig({
      ...modelConfig,
      systemPromptExtra: event.target.value,
    });
    setTestState({ status: 'idle' });
  };

  const handleTestMessageChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setTestMessage(event.target.value);
    setTestState({ status: 'idle' });
  };

  const handleTestConnection = async () => {
    const vendor = modelConfig.vendor;
    const defaults = vendorDefaults[vendor];
    const fallback = vendorPlaceholders[vendor];
    const apiKey = (modelConfig.apiKey ?? defaults?.apiKey ?? '').trim();
    if (!apiKey) {
      setTestState({ status: 'error', message: '请先填写该模型的 API Key。' });
      return;
    }
    setTestState({ status: 'loading' });
    try {
      const resolvedConfig: ModelConfig = {
        ...modelConfig,
        baseUrl: modelConfig.baseUrl?.trim() || defaults?.baseUrl || fallback.baseUrl,
        model: modelConfig.model?.trim() || defaults?.model || fallback.model,
        apiKey,
      };
      const result = await chatStream(
        [
          {
            role: 'system',
            content: '你是一名情感分类助手，请用中文简述用户语句的情绪倾向。',
          },
          {
            role: 'user',
            content: testMessage || '请判断：“今天天气真好，我心情棒极了！”这句话的情绪倾向。',
          },
        ],
        resolvedConfig,
        {
          temperature: resolvedConfig.temperature,
          maxTokens: resolvedConfig.max_output_tokens,
          stream: false,
          topP: resolvedConfig.top_p,
        },
      );
      setTestState({
        status: 'success',
        message: result || '（请求成功但未返回正文）',
      });
    } catch (error: any) {
      setTestState({
        status: 'error',
        message: error?.message ?? '请求异常，请检查网络或接口配置。',
      });
    }
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
          <span>API Key</span>
          <input
            type="password"
            value={modelConfig.apiKey ?? ''}
            placeholder={defaults.apiKey ? defaults.apiKey.replace(/./g, '•') : 'sk-...'}
            onChange={handleApiKeyChange}
          />
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
            placeholder="留空表示无限制"
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
      <label className="form-field">
        <span>连通性测试输入</span>
        <textarea
          value={testMessage}
          onChange={handleTestMessageChange}
          placeholder="例如：请判断“这段话充满希望！”的情绪倾向。"
        />
      </label>
      <div className="vendor-card__actions">
        <button
          type="button"
          className="button secondary"
          onClick={handleTestConnection}
          disabled={testState.status === 'loading'}
        >
          {testState.status === 'loading' ? '测试中…' : '测试连通'}
        </button>
      </div>
      {testState.status === 'success' && <pre className="vendor-test-result success">{testState.message}</pre>}
      {testState.status === 'error' && <pre className="vendor-test-result error">{testState.message}</pre>}
    </div>
  );
}
