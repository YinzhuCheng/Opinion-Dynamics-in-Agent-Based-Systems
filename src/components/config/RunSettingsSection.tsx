import type { ChangeEvent } from 'react';
import type { DialogueMode, ModelConfig, Vendor } from '../../types';
import { useAppStore } from '../../store/useAppStore';

const modeOptions: Array<{ value: DialogueMode; label: string; description: string }> = [
  { value: 'round_robin', label: '轮询对话', description: '严格按 Agent 顺序轮流发言，适合结构化讨论。' },
  { value: 'free', label: '自由对话', description: '按顺序轮询，但 Agent 可选择跳过发言，节奏更灵活。' },
];

export function RunSettingsSection() {
  const runConfig = useAppStore((state) => state.runState.config);
  const vendorDefaults = useAppStore((state) => state.vendorDefaults);
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
    updateGlobalModelConfig((prev?: ModelConfig) => ({
      ...(prev ?? {
        vendor,
        apiKeyRef: defaults.apiKeyRef,
        model: defaults.model ?? '',
        temperature: 0.7,
        top_p: 0.95,
        max_output_tokens: 2048,
      }),
      vendor,
      baseUrl: defaults.baseUrl ?? '',
      model: defaults.model ?? prev?.model ?? '',
      apiKeyRef: defaults.apiKeyRef,
    }));
  };

  const handleModelChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateGlobalModelConfig({ model: event.target.value });
  };

  const handleBaseUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateGlobalModelConfig({ baseUrl: event.target.value });
  };

  const handleApiKeyRefChange = (event: ChangeEvent<HTMLSelectElement>) => {
    updateGlobalModelConfig({ apiKeyRef: event.target.value as ModelConfig['apiKeyRef'] });
  };

  const handleNumberChange =
    (key: 'temperature' | 'top_p' | 'max_output_tokens') => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      updateGlobalModelConfig({
        [key]: value === '' ? undefined : Number(value),
      } as Partial<ModelConfig>);
    };

  const handleSystemPromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    updateGlobalModelConfig({ systemPromptExtra: event.target.value });
  };

  const globalConfig = runConfig.globalModelConfig;
  const selectedVendor = globalConfig?.vendor ?? 'openai';
  const vendorDefault = vendorDefaults[selectedVendor];

  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2>对话编排设置</h2>
          <p className="card__subtitle">选择对话模式、轮次/消息上限以及是否统一 LLM 配置。</p>
        </div>
      </header>
      <div className="card__body column-gap">
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
              <h3>统一模型配置</h3>
              <p className="form-hint">
                当前使用 {vendorLabels[selectedVendor]}，密钥来源：{globalConfig?.apiKeyRef === 'localEncrypted' ? '本地加密' : '内存'}。
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
                <span>密钥来源</span>
                <select value={globalConfig?.apiKeyRef ?? vendorDefault.apiKeyRef} onChange={handleApiKeyRefChange}>
                  <option value="memory">仅内存</option>
                  <option value="localEncrypted">本地加密</option>
                </select>
              </label>
              <label className="form-field">
                <span>模型名称</span>
                <input
                  type="text"
                  value={globalConfig?.model ?? vendorDefault.model ?? ''}
                  placeholder={vendorDefault.model ?? ''}
                  onChange={handleModelChange}
                />
              </label>
              <label className="form-field">
                <span>Base URL（可选）</span>
                <input
                  type="url"
                  value={globalConfig?.baseUrl ?? vendorDefault.baseUrl ?? ''}
                  placeholder={vendorDefault.baseUrl ?? 'https://...'}
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
                  value={globalConfig?.temperature ?? ''}
                  placeholder="0.7"
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
                  value={globalConfig?.top_p ?? ''}
                  placeholder="0.95"
                  onChange={handleNumberChange('top_p')}
                />
              </label>
              <label className="form-field">
                <span>最大输出 Tokens</span>
                <input
                  type="number"
                  min={16}
                  value={globalConfig?.max_output_tokens ?? ''}
                  placeholder="2048"
                  onChange={handleNumberChange('max_output_tokens')}
                />
              </label>
            </div>
            <label className="form-field">
              <span>额外系统提示（可选）</span>
              <textarea
                value={globalConfig?.systemPromptExtra ?? ''}
                placeholder="可补充统一的系统提示，例如讨论目标、语言要求等。"
                onChange={handleSystemPromptChange}
              />
            </label>
          </div>
        )}
      </div>
    </section>
  );
}

const vendorLabels: Record<Vendor, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude (Anthropic)',
  gemini: 'Gemini (Google)',
};
