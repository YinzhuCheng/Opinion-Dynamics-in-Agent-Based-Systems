import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type {
  DialogueMode,
  ModelConfig,
  Vendor,
  PromptToggleKey,
  Big5TraitKey,
  PersonaTraversalExperimentConfig,
} from '../../types';
import { DEFAULT_PROMPT_TOGGLES } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { chatStream } from '../../utils/llmAdapter';

const modeOptions: Array<{ value: DialogueMode; label: string; description: string }> = [
  { value: 'random', label: '随机顺序发言', description: '每轮开始前随机抽签决定出场顺序，所有 Agent 必须发言一次。' },
  { value: 'sequential', label: '依次发言', description: '固定按照列表顺序发言，每轮循环一次，适合结构化讨论。' },
];

const vendorLabels: Record<Vendor, string> = {
  openai: 'OpenAI',
  anthropic: 'Claude (Anthropic)',
  gemini: 'Gemini (Google)',
};

const vendorPlaceholders: Record<Vendor, { baseUrl: string; model: string }> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
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

const promptToggleOptions: Array<{
  key: PromptToggleKey;
  label: string;
  description: string;
}> = [
  {
    key: 'persona',
    label: '人格画像',
    description: '向模型提供角色描述与大五/MBTI 摘要，让语气与价值观保持一致。',
  },
  {
    key: 'trustMatrix',
    label: '信任度矩阵',
    description: '展示 DeGroot 权重与协作策略，指导各 Agent 如何参考彼此发言。',
  },
  {
    key: 'randomLength',
    label: '随机发言长度机制',
    description: '为每次出场随机指定 1~3 句并偶尔要求插入个人/身边实例，模拟口语节奏。',
  },
  {
    key: 'outputInnerState',
    label: '输出内在状态（state）',
    description:
      '要求模型输出结构化内在状态（personal/others/long/short）。关闭后将改用“完整对话回灌”作为记忆来源，以节省 token 并支持消融实验。',
  },
  {
    key: 'outputThink',
    label: '输出思考摘要（think）',
    description: '要求模型输出 2~3 句思考摘要。关闭后将只生成 content（以及可选 stance）。',
  },
  {
    key: 'memory',
    label: '记忆机制',
    description: '包含个人/他人发言记忆的摘要及私密回放提示，强化多轮连续性。',
  },
];

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
  const agents = useAppStore((state) => state.runState.agents);
  const discussion = useAppStore((state) => state.runState.config.discussion);
  const vendorDefaults = useAppStore((state) => state.vendorDefaults);
  const setVendorBaseUrl = useAppStore((state) => state.setVendorBaseUrl);
  const setVendorModel = useAppStore((state) => state.setVendorModel);
  const setVendorApiKey = useAppStore((state) => state.setVendorApiKey);
  const setRunMode = useAppStore((state) => state.setRunMode);
  const setMaxRounds = useAppStore((state) => state.setMaxRounds);
  const setUseGlobalModelConfig = useAppStore((state) => state.setUseGlobalModelConfig);
  const updateGlobalModelConfig = useAppStore((state) => state.updateGlobalModelConfig);
  const setStanceScaleSize = useAppStore((state) => state.setStanceScaleSize);
  const setPositiveViewpoint = useAppStore((state) => state.setPositiveViewpoint);
  const setNegativeViewpoint = useAppStore((state) => state.setNegativeViewpoint);
  const setPromptToggle = useAppStore((state) => state.setPromptToggle);
  const updateRunConfig = useAppStore((state) => state.updateRunConfig);
  const updateAgent = useAppStore((state) => state.updateAgent);
  const promptToggles = runConfig.promptToggles ?? DEFAULT_PROMPT_TOGGLES;
  const experiment = runConfig.personaTraversalExperiment;
  const [initialStanceA, setInitialStanceA] = useState<string>('');
  const [initialStanceB, setInitialStanceB] = useState<string>('');

  const experimentLevels = [10, 30, 50, 70, 90];
  const defaultDimensions: Big5TraitKey[] = ['O', 'A', 'N'];
  const isExperimentSupported = agents.length === 2;
  const resolvedExperimentDimensions = experiment?.dimensions ?? [];
  const resolvedExperimentLevels = experiment?.levels?.length ? experiment.levels : experimentLevels;
  const experimentM =
    resolvedExperimentDimensions.length > 0
      ? resolvedExperimentDimensions.length * resolvedExperimentLevels.length * resolvedExperimentLevels.length
      : 0;
  const clampedExperimentConcurrency = Math.max(1, Math.min(experimentM || 1, experiment?.concurrency ?? 1));

  const setExperimentConfig = (partial: Partial<PersonaTraversalExperimentConfig>) => {
    if (!isExperimentSupported) return;
    const agentIds: [string, string] =
      partial.agentIds ??
      experiment?.agentIds ??
      ([agents[0]?.id ?? '', agents[1]?.id ?? ''] as [string, string]);
    const nextDimensions = partial.dimensions ?? resolvedExperimentDimensions;
    const nextLevels = partial.levels ?? resolvedExperimentLevels;
    const M =
      nextDimensions.length > 0 ? nextDimensions.length * nextLevels.length * nextLevels.length : 0;
    const nextConcurrency = Math.max(1, Math.min(M || 1, partial.concurrency ?? clampedExperimentConcurrency));
    updateRunConfig((config) => ({
      ...config,
      personaTraversalExperiment: {
        enabled: partial.enabled ?? experiment?.enabled ?? false,
        agentIds,
        dimensions: nextDimensions,
        levels: nextLevels,
        concurrency: nextConcurrency,
        ...partial,
      },
    }));
  };

  const handleExperimentEnabledChange = (checked: boolean) => {
    if (!isExperimentSupported) return;
    if (!checked) {
      updateRunConfig((config) => ({ ...config, personaTraversalExperiment: undefined }));
      return;
    }
    updateRunConfig((config) => ({
      ...config,
      personaTraversalExperiment: {
        enabled: true,
        agentIds: [agents[0]?.id ?? '', agents[1]?.id ?? ''],
        dimensions: defaultDimensions,
        levels: experimentLevels,
        concurrency: 1,
      },
    }));
  };

  const includeDimension = (key: Big5TraitKey) => resolvedExperimentDimensions.includes(key);
  const toggleDimension = (key: Big5TraitKey, checked: boolean) => {
    const current = new Set<Big5TraitKey>(resolvedExperimentDimensions);
    if (checked) current.add(key);
    else current.delete(key);
    setExperimentConfig({ dimensions: Array.from(current) });
  };

  const maxLevel = Math.floor(Math.max(3, discussion.stanceScaleSize) / 2);
  const applyInitialStances = () => {
    if (!isExperimentSupported) return;
    const a = Number(initialStanceA);
    const b = Number(initialStanceB);
    if (Number.isFinite(a)) {
      const clampedA = Math.max(-maxLevel, Math.min(maxLevel, Math.round(a)));
      if (agents[0]) updateAgent(agents[0].id, { initialStance: clampedA });
    }
    if (Number.isFinite(b)) {
      const clampedB = Math.max(-maxLevel, Math.min(maxLevel, Math.round(b)));
      if (agents[1]) updateAgent(agents[1].id, { initialStance: clampedB });
    }
  };

  const clearInitialStances = () => {
    if (!isExperimentSupported) return;
    setInitialStanceA('');
    setInitialStanceB('');
    if (agents[0]) updateAgent(agents[0].id, { initialStance: undefined });
    if (agents[1]) updateAgent(agents[1].id, { initialStance: undefined });
  };

  const handleModeChange = (event: ChangeEvent<HTMLInputElement>) => {
    setRunMode(event.target.value as DialogueMode);
  };

  const handleMaxRoundsChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setMaxRounds(value ? Number(value) : undefined);
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

  const handleScaleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setStanceScaleSize(Number.isNaN(value) ? 3 : value);
  };

  const handlePositiveViewpointChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setPositiveViewpoint(event.target.value);
  };

  const handleNegativeViewpointChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setNegativeViewpoint(event.target.value);
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
          },
        );
        setTestState({
          status: 'success',
          message: result || '（请求成功但未返回发言内容）',
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

              <div className="discussion-block">
                <label className="form-field">
                  <span>立场刻度粒度</span>
                  <input
                    type="number"
                    min={3}
                    step={2}
                    value={discussion.stanceScaleSize}
                    onChange={handleScaleChange}
                  />
                  <p className="form-hint">
                    请输入一个 ≥3 的奇数，如 3、5、7。整数刻度会映射为 ±{Math.floor(discussion.stanceScaleSize / 2)}…0…±{Math.floor(discussion.stanceScaleSize / 2)}，绝对值越大代表立场越极端。
                  </p>
                </label>
                  <div className="grid two-columns">
                    <label className="form-field">
                      <span>正方观点</span>
                      <textarea
                        value={discussion.positiveViewpoint}
                        onChange={handlePositiveViewpointChange}
                        placeholder="例如：大语言模型的发展会造福人类"
                      />
                      <p className="form-hint">
                        描述当立场评分为正数/更极端正值时，Agent 想表达的核心观点。留空将自动使用 "大语言模型的发展会造福人类"。
                      </p>
                    </label>
                    <label className="form-field">
                      <span>反方观点</span>
                      <textarea
                        value={discussion.negativeViewpoint}
                        onChange={handleNegativeViewpointChange}
                        placeholder="例如：大语言模型的发展会威胁人类"
                      />
                      <p className="form-hint">
                        描述当立场评分为负数/更极端负值时的立场陈述。留空将自动使用 "大语言模型的发展会威胁人类"。
                      </p>
                    </label>
                  </div>
              </div>

              <div className="card-section">
                <h3 className="card-section-title">提示词构成（可做消融实验）</h3>
                <p className="form-hint">
                  取消勾选后，对应的提示片段将不会发送给模型，便于观察缺省某些机制时的行为差异。
                </p>
                <div className="grid two-columns">
                  {promptToggleOptions.map((option) => (
                    <label key={option.key} className="checkbox-field">
                      <div className="checkbox-description">
                        <input
                          type="checkbox"
                          checked={
                            option.key in promptToggles
                              ? promptToggles[option.key]
                              : DEFAULT_PROMPT_TOGGLES[option.key]
                          }
                          onChange={(event) => setPromptToggle(option.key, event.target.checked)}
                        />
                        <div>
                          <strong>{option.label}</strong>
                          <p className="form-hint">{option.description}</p>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {isExperimentSupported ? (
                <div className="card-section">
                  <h3 className="card-section-title">人格遍历实验（2 Agent）</h3>
                  <p className="form-hint">
                    固定其他参数，对两位 Agent 的同一人格维度做 5×5 网格遍历（取值 10/30/50/70/90）。
                    遍历某个维度时，其余人格维度一律设为 50。总实验规模记为 M，并支持并发 k（k ≤ M）。
                  </p>
                  <label className="checkbox-field">
                    <div className="checkbox-description">
                      <input
                        type="checkbox"
                        checked={Boolean(experiment?.enabled)}
                        onChange={(event) => handleExperimentEnabledChange(event.target.checked)}
                      />
                      <div>
                        <strong>启用人格遍历实验</strong>
                        <p className="form-hint">启用后，可在对话页点击“开始实验”启动批量轨道；单次对话仍可正常开始/停止。</p>
                      </div>
                    </div>
                  </label>

                  {experiment?.enabled ? (
                    <div className="grid two-columns">
                      <div className="form-field">
                        <span>参与遍历的 Agent</span>
                        <p className="form-hint">
                          本实验固定为 2 Agent：<strong>{agents[0]?.name}</strong> 与 <strong>{agents[1]?.name}</strong>。
                          每条轨道会同时覆盖两者的 Big5 为基线（50），再在所选维度上做 5×5 组合遍历。
                        </p>
                      </div>

                      <label className="form-field">
                        <span>并发轨道数 k（≤ M）</span>
                        <input
                          type="number"
                          min={1}
                          max={experimentM}
                          value={clampedExperimentConcurrency}
                          onChange={(event) => setExperimentConfig({ concurrency: Number(event.target.value) || 1 })}
                        />
                        <p className="form-hint">
                          当前实验规模 M = {experimentM || 0}（维度 {resolvedExperimentDimensions.join(', ') || '（未选择）'} × 5×5 档位组合）。
                        </p>
                      </label>

                      <div className="form-field">
                        <span>初始立场（A1/A2，可选，独立）</span>
                        <div className="grid two-columns">
                          <label className="form-field">
                            <span>{agents[0]?.name ?? 'A1'} 初始立场</span>
                            <input
                              type="number"
                              value={initialStanceA}
                              placeholder={`范围：-${maxLevel}…+${maxLevel}`}
                              onChange={(event) => setInitialStanceA(event.target.value)}
                            />
                          </label>
                          <label className="form-field">
                            <span>{agents[1]?.name ?? 'A2'} 初始立场</span>
                            <input
                              type="number"
                              value={initialStanceB}
                              placeholder={`范围：-${maxLevel}…+${maxLevel}`}
                              onChange={(event) => setInitialStanceB(event.target.value)}
                            />
                          </label>
                        </div>
                        <div className="vendor-card__actions">
                          <button
                            type="button"
                            className="button tertiary"
                            onClick={applyInitialStances}
                            title="分别写入两位 Agent 的 initialStance（首轮锁死）"
                          >
                            应用
                          </button>
                          <button
                            type="button"
                            className="button ghost"
                            onClick={clearInitialStances}
                            title="清空两位 Agent 的 initialStance（不再锁死首轮立场）"
                          >
                            清空
                          </button>
                        </div>
                        <p className="form-hint">
                          人格遍历只覆盖 Big5；initialStance 与人格独立。首轮立场锁死仅在对应 Agent 的 initialStance 有值时生效。
                        </p>
                      </div>

                      <div className="form-field">
                        <span>遍历维度</span>
                        <div className="grid two-columns">
                          {(['O', 'C', 'E', 'A', 'N'] as Big5TraitKey[]).map((key) => (
                            <label key={key} className="checkbox-field">
                              <div className="checkbox-description">
                                <input
                                  type="checkbox"
                                  checked={includeDimension(key)}
                                  onChange={(event) => toggleDimension(key, event.target.checked)}
                                />
                                <div>
                                  <strong>{key}</strong>
                                  <p className="form-hint">未勾选则该维度始终为 50</p>
                                </div>
                              </div>
                            </label>
                          ))}
                        </div>
                        <p className="form-hint">
                          至少选择 1 个维度才会生成轨道；不选则 M=0，实验无法启动。
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

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
      </div>
    </section>
  );
}
