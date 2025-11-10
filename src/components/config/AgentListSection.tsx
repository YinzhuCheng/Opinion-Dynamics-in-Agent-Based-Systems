import { useEffect } from 'react';
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
          model: vendorDefaults.openai.model ?? 'gpt-4.1-mini',
          apiKeyRef: vendorDefaults.openai.apiKeyRef,
          temperature: 0.7,
          top_p: 0.95,
          max_output_tokens: 2048,
          baseUrl: vendorDefaults.openai.baseUrl,
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
    <section className="card">
      <header className="card__header">
        <div>
          <h2>Agent 列表</h2>
          <p className="card__subtitle">配置每个 Agent 的画像、初始观点与独立模型（若启用自由配置）。</p>
        </div>
        <div className="card__actions">
          <button type="button" className="button primary" onClick={() => addAgent()}>
            新增 Agent
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
      </div>
    </section>
  );
}

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

  const handleVendorChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const vendor = event.target.value as Vendor;
    const defaults = vendorDefaults[vendor];
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        vendor,
        model: defaults.model ?? modelConfig.model,
        baseUrl: defaults.baseUrl ?? modelConfig.baseUrl,
        apiKeyRef: defaults.apiKeyRef,
      },
    });
  };

  const handleModelChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        model: event.target.value,
      },
    });
  };

  const handleBaseUrlChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        baseUrl: event.target.value,
      },
    });
  };

  const handleApiKeyRefChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        apiKeyRef: event.target.value as ModelConfig['apiKeyRef'],
      },
    });
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
    };

  const handleSystemPromptChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onChange(agent.id, {
      modelConfig: {
        ...modelConfig,
        systemPromptExtra: event.target.value,
      },
    });
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
            placeholder="2048"
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
    </div>
  );
};

