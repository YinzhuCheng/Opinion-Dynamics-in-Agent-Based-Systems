import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type {
  AgentSpec,
  MBTICode,
  ModelConfig,
  Persona,
  PersonaBig5,
  PersonaMBTI,
  PersonaType,
  Vendor,
} from '../../types';
import { useAppStore, type VendorDefaults } from '../../store/useAppStore';
import {
  BIG5_TEMPLATE_OPTIONS,
  MBTI_TEMPLATE_OPTIONS,
  MBTI_OPTIONS,
  BIG5_TRAIT_LABELS,
} from '../../data/personaTemplates';
import { chatStream } from '../../utils/llmAdapter';

type ConnectionTestState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
};

const vendorFallbacks: Record<Vendor, { baseUrl: string; model: string }> = {
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

const defaultBig5Persona = (): PersonaBig5 => ({
  type: 'big5',
  O: 60,
  C: 60,
  E: 50,
  A: 55,
  N: 45,
});

const defaultMBTIPersona = (): PersonaMBTI => ({
  type: 'mbti',
  mbti: 'INTJ',
});

export function AgentListSection() {
  const [collapsed, setCollapsed] = useState(false);
  const agents = useAppStore((state) => state.runState.agents);
  const runConfig = useAppStore((state) => state.runState.config);
  const vendorDefaults = useAppStore((state) => state.vendorDefaults);
  const addAgent = useAppStore((state) => state.addAgent);
  const updateAgent = useAppStore((state) => state.updateAgent);
  const removeAgent = useAppStore((state) => state.removeAgent);

    useEffect(() => {
      if (!runConfig.useGlobalModelConfig) {
        const fallback: ModelConfig =
          runConfig.globalModelConfig ??
          ({
            vendor: 'openai',
            baseUrl: vendorDefaults.openai.baseUrl ?? '',
            apiKey: vendorDefaults.openai.apiKey ?? '',
            model: vendorDefaults.openai.model ?? 'gpt-4o',
            temperature: 0.7,
            top_p: 0.95,
            max_output_tokens: 2048,
          } satisfies ModelConfig);
        agents.forEach((agent) => {
          if (!agent.modelConfig) {
            updateAgent(agent.id, { modelConfig: { ...fallback } });
          }
        });
      }
    }, [
      agents,
      runConfig.useGlobalModelConfig,
      runConfig.globalModelConfig,
      updateAgent,
      vendorDefaults,
    ]);

  const handlePersonaTypeChange =
    (agent: AgentSpec) => (event: ChangeEvent<HTMLSelectElement>) => {
      const nextType = event.target.value as PersonaType;
      let persona: Persona;
      if (nextType === 'big5') {
        persona = defaultBig5Persona();
      } else if (nextType === 'mbti') {
        persona = defaultMBTIPersona();
      } else {
        persona = { type: 'free', description: '' };
      }
      updateAgent(agent.id, { persona });
    };

  const handleAgentNameChange =
    (agent: AgentSpec) => (event: ChangeEvent<HTMLInputElement>) => {
      updateAgent(agent.id, { name: event.target.value });
    };

  const handleInitialOpinionChange =
    (agent: AgentSpec) => (event: ChangeEvent<HTMLTextAreaElement>) => {
      updateAgent(agent.id, { initialOpinion: event.target.value });
    };

  return (
    <section className={`card ${collapsed ? 'card--collapsed' : ''}`}>
      <header className="card__header">
        <div>
          <h2>Agent 列表</h2>
          <p className="card__subtitle">配置每个 Agent 的画像、初始观点与独立模型（若启用自由配置）。</p>
        </div>
        <div className="card__actions">
          <button type="button" className="button primary" onClick={() => addAgent()}>
            新增 Agent
          </button>
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
        {agents.map((agent, index) => (
          <div key={agent.id} className="agent-card">
            <div className="agent-card__header">
              <div>
                <h3>{agent.name}</h3>
                <p className="form-hint">Agent #{index + 1}</p>
              </div>
              <div className="agent-card__header-actions">
                <button type="button" className="button ghost" onClick={() => updateAgent(agent.id, { name: `A${index + 1}` })}>
                  重命名为 A{index + 1}
                </button>
                {agents.length > 1 && (
                  <button type="button" className="button ghost" onClick={() => removeAgent(agent.id)}>
                    删除
                  </button>
                )}
              </div>
            </div>

            <div className="grid two-columns">
              <label className="form-field">
                <span>显示名称</span>
                <input type="text" value={agent.name} onChange={handleAgentNameChange(agent)} />
              </label>

              <label className="form-field">
                <span>画像类型</span>
                <select value={agent.persona.type} onChange={handlePersonaTypeChange(agent)}>
                  <option value="big5">大五人格</option>
                  <option value="mbti">MBTI</option>
                  <option value="free">自由画像</option>
                </select>
              </label>
            </div>

            <PersonaEditor agent={agent} />

            <label className="form-field">
              <span>初始观点（可空）</span>
              <textarea
                placeholder="可用于指定起始立场或已有观点，留空则由系统提示引导。"
                value={agent.initialOpinion ?? ''}
                onChange={handleInitialOpinionChange(agent)}
              />
            </label>

            {!runConfig.useGlobalModelConfig && (
              <AgentModelConfigEditor agent={agent} onChange={updateAgent} vendorDefaults={vendorDefaults} />
            )}
          </div>
          ))}
        <TrustMatrixEditor />
      </div>
    </section>
  );
}

const TrustMatrixEditor = () => {
  const agents = useAppStore((state) => state.runState.agents);
  const trustMatrix = useAppStore((state) => state.runState.config.trustMatrix);
  const setTrustValue = useAppStore((state) => state.setTrustValue);
  const normalizeTrustRow = useAppStore((state) => state.normalizeTrustRow);
  const randomizeTrustMatrix = useAppStore((state) => state.randomizeTrustMatrix);
  const uniformTrustMatrix = useAppStore((state) => state.uniformTrustMatrix);

  if (agents.length === 0) {
    return null;
  }

  const exampleSource = agents[0]?.name ?? 'A1';
  const exampleTarget = agents[1]?.name ?? agents[0]?.name ?? 'A1';
  const exampleText =
    agents.length > 1
      ? `例如：若 ${exampleSource} 对 ${exampleTarget} 的信任度填入 0.7，表示在整合上一轮观点时会以 70% 权重参考 ${exampleTarget} 的发言。`
      : '当前仅有 1 名 Agent，系统会默认将自身观点的权重设为 1。';

  const handleCellChange =
    (sourceId: string, targetId: string) => (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      const numeric = raw === '' ? 0 : Number(raw);
      setTrustValue(sourceId, targetId, Number.isNaN(numeric) ? 0 : numeric);
    };

  return (
    <div className="trust-matrix-block">
      <h4>信任度矩阵（DeGroot）</h4>
      <p className="form-hint">
        {exampleText}
        <br />
        每一行代表“该 Agent 聚合上一轮观点时如何加权他人”，数值范围建议 0–1，可点击“归一化”让该行加总为 1。
      </p>
      <div className="trust-matrix-table-wrapper">
        <table className="trust-matrix-table">
          <thead>
            <tr>
              <th scope="col">来源 \\ 目标</th>
              {agents.map((agent) => (
                <th scope="col" key={`trust-target-${agent.id}`}>
                  {agent.name}
                </th>
              ))}
              <th scope="col">行操作</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((source) => (
              <tr key={`trust-row-${source.id}`}>
                <th scope="row">{source.name}</th>
                {agents.map((target) => {
                  const value = trustMatrix[source.id]?.[target.id] ?? (source.id === target.id ? 1 : 0);
                  return (
                    <td key={`trust-cell-${source.id}-${target.id}`}>
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={value}
                        onChange={handleCellChange(source.id, target.id)}
                      />
                    </td>
                  );
                })}
                <td>
                  <button type="button" className="button ghost" onClick={() => normalizeTrustRow(source.id)}>
                    归一化
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="trust-matrix-actions">
        <button type="button" className="button secondary" onClick={randomizeTrustMatrix}>
          随机初始化
        </button>
        <button type="button" className="button ghost" onClick={uniformTrustMatrix}>
          均匀初始化
        </button>
      </div>
    </div>
  );
};

const PersonaEditor = ({ agent }: { agent: AgentSpec }) => {
  if (agent.persona.type === 'big5') {
    return <Big5Editor agent={agent} />;
  }
  if (agent.persona.type === 'mbti') {
    return <MBTIEditor agent={agent} />;
  }
  return <FreePersonaEditor agent={agent} />;
};

const Big5Editor = ({ agent }: { agent: AgentSpec }) => {
  const updateAgent = useAppStore((state) => state.updateAgent);
  const persona = agent.persona as PersonaBig5;

  const handleScoreChange =
    (key: keyof Omit<PersonaBig5, 'type' | 'templateKey' | 'notes'>) =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = Math.max(1, Math.min(100, Number(event.target.value)));
      updateAgent(agent.id, {
        persona: {
          ...persona,
          [key]: value,
        },
      });
    };

  const handleTemplateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const templateKey = event.target.value || undefined;
    const template = BIG5_TEMPLATE_OPTIONS.find((item) => item.key === templateKey);
    updateAgent(agent.id, {
      persona: {
        ...persona,
        templateKey,
        notes: template?.notes ?? persona.notes ?? '',
      },
    });
  };

  const handleNotesChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    updateAgent(agent.id, {
      persona: {
        ...persona,
        notes: event.target.value,
      },
    });
  };

    return (
      <div className="persona-panel">
        <div className="persona-grid">
          {(['O', 'C', 'E', 'A', 'N'] as const).map((dimension) => (
            <label key={dimension} className="form-field">
              <span>
                {dimension}（1-100）
                <small className="form-hint-inline">{BIG5_TRAIT_LABELS[dimension]}</small>
              </span>
              <input
                type="number"
                min={1}
                max={100}
                value={persona[dimension]}
                onChange={handleScoreChange(dimension)}
              />
            </label>
          ))}
        </div>
        <label className="form-field">
          <span>性格模板（可选）</span>
          <select value={persona.templateKey ?? ''} onChange={handleTemplateChange}>
            <option value="">无模板</option>
            {BIG5_TEMPLATE_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>补充说明</span>
          <textarea
            placeholder="描述该 Agent 的动机、沟通风格或注意事项。"
            value={persona.notes ?? ''}
            onChange={handleNotesChange}
          />
        </label>
      </div>
    );
};

const MBTIEditor = ({ agent }: { agent: AgentSpec }) => {
  const updateAgent = useAppStore((state) => state.updateAgent);
  const persona = agent.persona as PersonaMBTI;

  const handleMBTIChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const mbti = event.target.value as MBTICode;
    updateAgent(agent.id, {
      persona: {
        ...persona,
        mbti,
      },
    });
  };

  const handleTemplateChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const templateKey = event.target.value || undefined;
    const template = MBTI_TEMPLATE_OPTIONS.find((item) => item.key === templateKey);
    updateAgent(agent.id, {
      persona: {
        ...persona,
        templateKey,
        notes: template?.notes ?? persona.notes ?? '',
      },
    });
  };

  const handleNotesChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    updateAgent(agent.id, {
      persona: {
        ...persona,
        notes: event.target.value,
      },
    });
  };

  return (
    <div className="persona-panel">
      <label className="form-field">
        <span>MBTI 类型</span>
        <select value={persona.mbti} onChange={handleMBTIChange}>
          {MBTI_OPTIONS.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>沟通风格模板（可选）</span>
        <select value={persona.templateKey ?? ''} onChange={handleTemplateChange}>
          <option value="">无模板</option>
          {MBTI_TEMPLATE_OPTIONS.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-field">
        <span>补充说明</span>
        <textarea
          placeholder="描述该类型在讨论中的表达方式、偏好或禁忌。"
          value={persona.notes ?? ''}
          onChange={handleNotesChange}
        />
      </label>
    </div>
  );
};

const FreePersonaEditor = ({ agent }: { agent: AgentSpec }) => {
  const updateAgent = useAppStore((state) => state.updateAgent);
  if (agent.persona.type !== 'free') return null;
  return (
    <label className="form-field">
      <span>画像描述</span>
      <textarea
        placeholder="可描述性格、动机、专业背景、立场或禁忌。"
        value={agent.persona.description}
        onChange={(event) =>
          updateAgent(agent.id, {
            persona: {
              type: 'free',
              description: event.target.value,
            },
          })
        }
      />
    </label>
  );
};

const AgentModelConfigEditor = ({
  agent,
  onChange,
  vendorDefaults,
}: {
  agent: AgentSpec;
  onChange: (id: string, updater: Partial<AgentSpec>) => void;
  vendorDefaults: VendorDefaults;
}) => {
  const modelConfig = agent.modelConfig;
  if (!modelConfig) return null;

  const [testState, setTestState] = useState<ConnectionTestState>({ status: 'idle' });
  const [testMessage, setTestMessage] = useState('请给出一句示例发言。');

  const handleVendorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const vendor = event.target.value as Vendor;
    const defaults = vendorDefaults[vendor];
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        vendor,
        model: defaults.model ?? modelConfig.model,
        baseUrl: defaults.baseUrl ?? modelConfig.baseUrl,
        apiKey: defaults.apiKey ?? modelConfig.apiKey ?? '',
      },
    });
    setTestState({ status: 'idle' });
  };

  const handleModelChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        model: event.target.value,
      },
    });
    setTestState({ status: 'idle' });
  };

  const handleBaseUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        baseUrl: event.target.value,
      },
    });
    setTestState({ status: 'idle' });
  };

  const handleApiKeyChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        apiKey: event.target.value,
      },
    });
    setTestState({ status: 'idle' });
  };

  const handleNumberChange =
    (key: 'temperature' | 'top_p' | 'max_output_tokens') =>
    (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      onChange(agent.id, {
        modelConfig: {
          ...modelConfig,
          [key]: value === '' ? undefined : Number(value),
        },
      });
      setTestState({ status: 'idle' });
    };

  const handleSystemPromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        systemPromptExtra: event.target.value,
      },
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
    const fallback = vendorFallbacks[vendor];
    const apiKey = (modelConfig.apiKey ?? defaults?.apiKey ?? '').trim();
    if (!apiKey) {
      setTestState({ status: 'error', message: '请为该 Agent 填写 API Key。' });
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
            content: '你是多智能体讨论中的一员，请围绕议题给出简短回答。',
          },
          {
            role: 'user',
            content: testMessage || '请举例说明你将如何参与讨论。',
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
        message: result || '（请求成功但未返回正文）',
      });
    } catch (error: any) {
      setTestState({
        status: 'error',
        message: error?.message ?? '请求异常，请检查网络或 Worker 配置。',
      });
    }
  };

  const defaults = vendorDefaults[modelConfig.vendor];

  return (
    <div className="agent-model-panel">
      <h4>独立模型配置</h4>
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
            value={modelConfig.top_p ?? ''}
            placeholder="0.95"
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
          placeholder="可指定该 Agent 的角色要求、语言风格等。"
          onChange={handleSystemPromptChange}
        />
      </label>
      <label className="form-field">
        <span>连通性测试输入</span>
        <textarea
          value={testMessage}
          onChange={handleTestMessageChange}
          placeholder="例如：请说明你将在讨论中先发言的角度。"
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
      {testState.status === 'success' && (
        <pre className="vendor-test-result success">{testState.message}</pre>
      )}
      {testState.status === 'error' && (
        <pre className="vendor-test-result error">{testState.message}</pre>
      )}
    </div>
  );
};

