import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import { testVendorConnection } from '../../utils/api';
import type { Vendor } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useSecretsStore } from '../../store/useSecretsStore';

const vendorLabels: Record<Vendor, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude (Anthropic)',
  gemini: 'Gemini (Google)',
};

const vendorPlaceholders: Record<Vendor, { baseUrl: string; model: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
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

export function ModelKeysSection() {
  const vendorDefaults = useAppStore((state) => state.vendorDefaults);
  const setVendorBaseUrl = useAppStore((state) => state.setVendorBaseUrl);
  const setVendorModel = useAppStore((state) => state.setVendorModel);
  const setVendorApiKeyRef = useAppStore((state) => state.setVendorApiKeyRef);

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

  const handleBaseUrlChange = (vendor: Vendor) => (event: ChangeEvent<HTMLInputElement>) => {
    setVendorBaseUrl(vendor, event.target.value);
  };

  const handleModelChange = (vendor: Vendor) => (event: ChangeEvent<HTMLInputElement>) => {
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

  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2>模型与密钥</h2>
          <p className="card__subtitle">填写各厂商的 Base URL 与 API Key，可测试连通并选择存储方式。</p>
        </div>
      </header>
      <div className="card__body column-gap">
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
                    onChange={handleBaseUrlChange(vendor)}
                  />
                </label>
                <label className="form-field">
                  <span>默认模型名</span>
                  <input
                    type="text"
                    value={vendorDefaults[vendor].model ?? ''}
                    placeholder={placeholder.model}
                    onChange={handleModelChange(vendor)}
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
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => clearApiKey(vendor)}
                  >
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
    </section>
  );
}
