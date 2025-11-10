import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { testVendorConnection } from '../../utils/api';
import type { DialogueMode, ModelConfig, Vendor } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useSecretsStore } from '../../store/useSecretsStore';

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

type ConnectionState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
};

export function RunSettingsSection() {
  const [collapsed, setCollapsed] = useState(false);

  const runConfig = useAppStore((state) => state.runState.config);
  const vendorDefaults = useAppStore((state) => state.vendorDefaults);
  const setVendorBaseUrl = useAppStore((state) => state.setVendorBaseUrl);
  const setVendorModel = useAppStore((state) => state.setVendorModel);
  const setVendorApiKeyRef = useAppStore((state) => state.setVendorApiKeyRef);
  const setRunMode = useAppStore((state) => state.setRunMode);
  const setMaxRounds = useAppStore((state) => state.setMaxRounds);
  const setMaxMessages = useAppStore((state) => state.setMaxMessages);
  const setUseGlobalModelConfig = useAppStore((state) => state.setUseGlobalModelConfig);
  const updateGlobalModelConfig = useAppStore((state) => state.updateGlobalModelConfig);

  const {
    apiKeys,
    encryptionEnabled,
    encryptionUnlocked,
    hasStoredCiphertext,
    lastSavedAt,
    passphrase,
    error,
    initializeFromStorage,
    setApiKey,
    clearApiKey,
    saveEncrypted,
    loadEncrypted,
    disableEncryption,
    forgetEncrypted,
    setError,
  } = useSecretsStore();

  useEffect(() => {
    initializeFromStorage();
  }, [initializeFromStorage]);

  const [showKeys, setShowKeys] = useState<Record<Vendor, boolean>>({
    openai: false,
    anthropic: false,
    gemini: false,
  });
  const [connectionState, setConnectionState] = useState<Record<Vendor, ConnectionState>>({
    openai: { status: 'idle' },
    anthropic: { status: 'idle' },
    gemini: { status: 'idle' },
  });
  const [encryptionPassword, setEncryptionPassword] = useState('');
  const [encryptionBusy, setEncryptionBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!passphrase) {
      setEncryptionPassword('');
    }
  }, [passphrase]);

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

  const handleGlobalModelChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateGlobalModelConfig({ model: event.target.value });
  };

  const handleGlobalBaseUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    updateGlobalModelConfig({ baseUrl: event.target.value });
  };

  const handleGlobalApiKeyRefChange = (event: ChangeEvent<HTMLSelectElement>) => {
    updateGlobalModelConfig({ apiKeyRef: event.target.value as ModelConfig['apiKeyRef'] });
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

  const handleApiKeyChange = (vendor: Vendor) => async (event: ChangeEvent<HTMLInputElement>) => {
    try {
      await setApiKey(vendor, event.target.value.trim());
    } catch (err) {
      console.error(err);
    }
  };

  const handleStorageChange = (vendor: Vendor) => (event: ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value as 'memory' | 'localEncrypted';
    if (value === 'localEncrypted' && !encryptionUnlocked) {
      setError('请先输入口令并加载加密存储后，再选择“本地加密”。');
      return;
    }
    setVendorApiKeyRef(vendor, value);
  };

  const handleEncryptionSave = async () => {
    if (!encryptionPassword) {
      setError('请先输入用于加密的口令。');
      return;
    }
    setEncryptionBusy(true);
    try {
      await saveEncrypted(encryptionPassword);
    } catch (err) {
      console.error(err);
    } finally {
      setEncryptionBusy(false);
    }
  };

  const handleEncryptionLoad = async () => {
    if (!encryptionPassword) {
      setError('请输入用于解锁的口令。');
      return;
    }
    setEncryptionBusy(true);
    try {
      const ok = await loadEncrypted(encryptionPassword);
      if (!ok) {
        setEncryptionPassword('');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setEncryptionBusy(false);
    }
  };

  const handleEncryptionDisable = async () => {
    setEncryptionBusy(true);
    try {
      disableEncryption();
      setEncryptionPassword('');
    } finally {
      setEncryptionBusy(false);
    }
  };

  const handleEncryptionForget = async () => {
    setEncryptionBusy(true);
    try {
      forgetEncrypted();
    } finally {
      setEncryptionBusy(false);
    }
  };

  const handleTestConnection = async (vendor: Vendor) => {
    const apiKey = apiKeys[vendor];
    if (!apiKey) {
      setConnectionState((prev) => ({
        ...prev,
        [vendor]: { status: 'error', message: '请先填写 API Key。' },
      }));
      return;
    }
    const { baseUrl } = vendorDefaults[vendor];
    const model = vendorDefaults[vendor].model || vendorPlaceholders[vendor].model;
    setConnectionState((prev) => ({
      ...prev,
      [vendor]: { status: 'loading' },
    }));
    try {
      const response = await testVendorConnection({
        vendor,
        apiKey,
        baseUrl: baseUrl || undefined,
        model,
      });
      if (response.ok) {
        setConnectionState((prev) => ({
          ...prev,
          [vendor]: { status: 'success', message: '连通成功。' },
        }));
      } else {
        setConnectionState((prev) => ({
          ...prev,
          [vendor]: { status: 'error', message: response.error?.message ?? '连通失败。' },
        }));
      }
    } catch (err: any) {
      setConnectionState((prev) => ({
        ...prev,
        [vendor]: { status: 'error', message: err?.message ?? '连通失败。' },
      }));
    }
  };

  const encryptionStatusText = useMemo(() => {
    if (!encryptionEnabled) return '当前仅保存在内存中，关闭页面即失效。';
    if (!encryptionUnlocked) return '已检测到加密存储，请输入口令解锁。';
    if (lastSavedAt) return `已启用加密存储，上次保存：${new Date(lastSavedAt).toLocaleString()}`;
    return '已启用加密存储。';
  }, [encryptionEnabled, encryptionUnlocked, lastSavedAt]);

  const globalConfig = runConfig.globalModelConfig;
  const selectedVendor = globalConfig?.vendor ?? 'openai';
  const vendorDefault = vendorDefaults[selectedVendor];

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
              const baseUrl = vendorDefaults[vendor].baseUrl ?? '';
              const apiKey = apiKeys[vendor] ?? '';
              const storageStrategy = vendorDefaults[vendor].apiKeyRef;
              const state = connectionState[vendor];
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
                      value={baseUrl}
                      placeholder={placeholder.baseUrl}
                      onChange={handleVendorBaseUrlChange(vendor)}
                    />
                  </label>
                  <label className="form-field">
                    <span>默认模型名</span>
                    <input
                      type="text"
                      value={vendorDefaults[vendor].model ?? ''}
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
                        value={apiKey}
                        onChange={handleApiKeyChange(vendor)}
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
                  <label className="form-field">
                    <span>密钥存储</span>
                    <select value={storageStrategy} onChange={handleStorageChange(vendor)}>
                      <option value="memory">仅内存（当前会话）</option>
                      <option value="localEncrypted" disabled={!encryptionUnlocked}>
                        本地加密（需口令）
                      </option>
                    </select>
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
                    <button type="button" className="button ghost" onClick={() => clearApiKey(vendor)}>
                      清空
                    </button>
                  </div>
                  {state.status === 'success' && <p className="form-hint success">{state.message}</p>}
                  {state.status === 'error' && <p className="form-hint error">{state.message}</p>}
                </div>
              );
            })}
          </div>

          <div className="encryption-card">
            <h3>本地加密保存</h3>
            <p className="form-hint">{encryptionStatusText}</p>
            <label className="form-field">
              <span>加密口令</span>
              <div className="form-field__input-with-action">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="请输入口令（不少于 8 位）"
                  value={encryptionPassword}
                  onChange={(event) => setEncryptionPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="button tertiary"
                  onClick={() => setShowPassword((prev) => !prev)}
                >
                  {showPassword ? '隐藏' : '显示'}
                </button>
              </div>
            </label>
            <div className="encryption-actions">
              <button
                type="button"
                className="button primary"
                onClick={handleEncryptionSave}
                disabled={encryptionBusy}
              >
                保存到本地
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={handleEncryptionLoad}
                disabled={encryptionBusy || !hasStoredCiphertext}
              >
                解锁并载入
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={handleEncryptionDisable}
                disabled={encryptionBusy || !encryptionEnabled}
              >
                停用加密
              </button>
              <button
                type="button"
                className="button ghost"
                onClick={handleEncryptionForget}
                disabled={encryptionBusy || !hasStoredCiphertext}
              >
                清除已保存
              </button>
            </div>
            {error && <p className="form-hint error">{error}</p>}
            <p className="form-hint">
              口令仅在当前标签页内存中保留，不会上传到服务器。启用加密后，建议刷新页面时重新输入口令。
            </p>
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
                  当前使用 {vendorLabels[selectedVendor]}，密钥来源：
                  {globalConfig?.apiKeyRef === 'localEncrypted' ? '本地加密' : '内存'}。
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
                  <select value={globalConfig?.apiKeyRef ?? vendorDefault.apiKeyRef} onChange={handleGlobalApiKeyRefChange}>
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
                    onChange={handleGlobalModelChange}
                  />
                </label>
                <label className="form-field">
                  <span>Base URL（可选）</span>
                  <input
                    type="url"
                    value={globalConfig?.baseUrl ?? vendorDefault.baseUrl ?? ''}
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
                    value={globalConfig?.temperature ?? ''}
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
                    value={globalConfig?.top_p ?? ''}
                    placeholder="0.95"
                    onChange={handleGlobalNumberChange('top_p')}
                  />
                </label>
                <label className="form-field">
                  <span>最大输出 Tokens</span>
                  <input
                    type="number"
                    min={16}
                    value={globalConfig?.max_output_tokens ?? ''}
                    placeholder="2048"
                    onChange={handleGlobalNumberChange('max_output_tokens')}
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
      </div>
    </section>
  );
}
