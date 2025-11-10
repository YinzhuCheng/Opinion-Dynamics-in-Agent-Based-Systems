import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { testVendorConnection } from '../../utils/api';
import type { DialogueMode, ModelConfig, Vendor } from '../../types';
import { useAppStore } from '../../store/useAppStore';

const modeOptions: Array<{ value: DialogueMode; label: string; description: string }> = [
  { value: 'round_robin', label: '轮询对话', description: '严格按 Agent 顺序轮流发言，适合结构化讨论。' },
  { value: 'free', label: '自由对话', description: '按顺序轮询，但 Agent 可选择跳过发言，节奏更灵活。' },
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
  const [showKeys, setShowKeys] = useState<Record<Vendor, boolean>>({
    openai: false,
    anthropic: false,
    gemini: false,
  });
  const [testMessages, setTestMessages] = useState<Record<Vendor, string>>({
    openai: '你好，能听到吗？',
    anthropic: 'Hello Claude, are you there?',
    gemini: 'Ping from UI, please respond.',
  });
  const [testStates, setTestStates] = useState<Record<Vendor, TestState>>({
    openai: { status: 'idle' },
    anthropic: { status: 'idle' },
    gemini: { status: 'idle' },
  });

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
      temperature: 0.7,
      top_p: 0.95,
      max_output_tokens: 2048,
      systemPromptExtra: '',
    }));
  };

  const handleGlobalModelChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    updateGlobalModelConfig({ model: value });
    setVendorModel(selectedVendor, value);
  };

  const handleGlobalBaseUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    updateGlobalModelConfig({ baseUrl: value });
    setVendorBaseUrl(selectedVendor, value);
  };

  const handleGlobalApiKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    updateGlobalModelConfig({ apiKey: value });
    setVendorApiKey(selectedVendor, value);
  };

  const handleGlobalNumberChange =
    (key: 'temperature' | 'top_p' | 'max_output_tokens') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      updateGlobalModelConfig({
        [key]: value === '' ? undefined : Number(value),
      } as Partial<ModelConfig>);
    };

  const handleSystemPromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    updateGlobalModelConfig({ systemPromptExtra: event.target.value });
  };

  const handleVendorBaseUrlChange = (vendor: Vendor) => (event: ChangeEvent<HTMLInputElement>) => {
    setVendorBaseUrl(vendor, event.target.value);
  };

  const handleVendorModelChange = (vendor: Vendor) => (event: ChangeEvent<HTMLInputElement>) => {
    setVendorModel(vendor, event.target.value);
  };

  const handleVendorApiKeyChange = (vendor: Vendor) => (event: ChangeEvent<HTMLInputElement>) => {
    setVendorApiKey(vendor, event.target.value);
  };

  const handleTestMessageChange = (vendor: Vendor) => (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setTestMessages((prev) => ({ ...prev, [vendor]: value }));
  };

  const handleTestConnection = async (vendor: Vendor) => {
    const vendorConfig = vendorDefaults[vendor];
    const apiKey = vendorConfig.apiKey?.trim();
    if (!apiKey) {
      setTestStates((prev) => ({
        ...prev,
        [vendor]: { status: 'error', message: '请先填写 API Key。' },
      }));
      return;
    }
    setTestStates((prev) => ({
      ...prev,
      [vendor]: { status: 'loading' },
    }));
    try {
      const response = await testVendorConnection({
        vendor,
        apiKey,
        baseUrl: vendorConfig.baseUrl || undefined,
        model: vendorConfig.model || vendorPlaceholders[vendor].model,
        messages: [
          {
            role: 'system',
            content: '你是连通性测试助手，请用简洁中文回答用户输入，以确认接口可用。',
          },
          {
            role: 'user',
            content: testMessages[vendor] || '你好，能否收到？',
          },
        ],
      });
      if (response.ok) {
        setTestStates((prev) => ({
          ...prev,
          [vendor]: { status: 'success', message: response.content || '（无返回内容）' },
        }));
      } else {
        setTestStates((prev) => ({
          ...prev,
          [vendor]: {
            status: 'error',
            message: response.error?.message ?? '连通失败。',
          },
        }));
      }
    } catch (error: any) {
      setTestStates((prev) => ({
        ...prev,
        [vendor]: { status: 'error', message: error?.message ?? '连通失败。' },
      }));
    }
  };

  const selectedVendor = runConfig.globalModelConfig?.vendor ?? 'openai';
  const vendorDefault = vendorDefaults[selectedVendor];
  const globalConfig = runConfig.globalModelConfig ?? {
    vendor: selectedVendor,
    baseUrl: vendorDefault.baseUrl ?? '',
    apiKey: vendorDefault.apiKey ?? '',
    model: vendorDefault.model ?? vendorPlaceholders[selectedVendor].model,
    temperature: 0.7,
    top_p: 0.95,
    max_output_tokens: 2048,
    systemPromptExtra: '',
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
          <h3 className="card-section-title">模型与密钥</h3>
          <div className="vendor-card-grid">
            {(Object.keys(vendorLabels) as Vendor[]).map((vendor) => {
              const label = vendorLabels[vendor];
              const vendorConfig = vendorDefaults[vendor];
              const state = testStates[vendor];
              const placeholder = vendorPlaceholders[vendor];
              return (
                <div key={vendor} className="vendor-card">
                  <div className="vendor-card__header">
                    <h3>{label}</h3>
                    <span className="vendor-card__badge">{vendor.toUpperCase()}</span>
                  </div>
                  <label className="form-field">
                    <span>Base URL（可选）</span>
                    <input
                      type="url"
                      value={vendorConfig.baseUrl ?? ''}
                      placeholder={placeholder.baseUrl}
                      onChange={handleVendorBaseUrlChange(vendor)}
                    />
                  </label>
                  <label className="form-field">
                    <span>默认模型名</span>
                    <input
                      type="text"
                      value={vendorConfig.model ?? ''}
                      placeholder={placeholder.model}
                      onChange={handleVendorModelChange(vendor)}
                    />
                  </label>
                  <label className="form-field">
                    <span>API Key</span>
                    <div className="form-field__input-with-action">
                      <input
                        type={showKeys[vendor] ? 'text' : 'password'}
                        autoComplete="off"
                        value={vendorConfig.apiKey ?? ''}
                        onChange={handleVendorApiKeyChange(vendor)}
                        placeholder="sk-..."
                      />
                      <button
                        type="button"
                        className="button tertiary"
                        onClick={() =>
                          setShowKeys((prev) => ({
                            ...prev,
                            [vendor]: !prev[vendor],
                          }))
                        }
                      >
                        {showKeys[vendor] ? '隐藏' : '显示'}
                      </button>
                    </div>
                  </label>

                  <div className="vendor-test-area">
                    <label className="form-field">
                      <span>连通性测试输入</span>
                      <textarea
                        value={testMessages[vendor]}
                        onChange={handleTestMessageChange(vendor)}
                        placeholder="请输入想要测试的内容，例如：请用一句话介绍你自己。"
                      />
                    </label>
                    <div className="vendor-card__actions">
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => handleTestConnection(vendor)}
                        disabled={state.status === 'loading'}
                      >
                        {state.status === 'loading' ? '测试中…' : '测试连通'}
                      </button>
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => setVendorApiKey(vendor, '')}
                      >
                        清空密钥
                      </button>
                    </div>
                    {state.status === 'success' && (
                      <pre className="vendor-test-result success">{state.message}</pre>
                    )}
                    {state.status === 'error' && (
                      <pre className="vendor-test-result error">{state.message}</pre>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

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
                  <input
                    type={showKeys[selectedVendor] ? 'text' : 'password'}
                    value={globalConfig.apiKey ?? ''}
                    onChange={handleGlobalApiKeyChange}
                    placeholder="sk-..."
                  />
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
                    placeholder="2048"
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
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
