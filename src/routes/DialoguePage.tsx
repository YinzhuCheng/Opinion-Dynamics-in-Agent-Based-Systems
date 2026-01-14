import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { startConversation, stopConversation } from '../engine/conversationRunner';
import { startPersonaTraversalExperiment, stopPersonaTraversalExperiment } from '../engine/experimentRunner';
import { resolveAgentNameMap } from '../utils/names';
import type { Big5TraitKey, ExperimentTrackSelector, ExperimentTrackMeta } from '../types';

type TimelineSection = 'innerState' | 'thought' | 'speech' | 'stance';

export function DialoguePage() {
  const { messages, agents, status } = useAppStore((state) => state.runState);
  const runConfig = useAppStore((state) => state.runState.config);
  const experiments = useAppStore((state) => state.experiments);
  const activeExperimentId = useAppStore((state) => state.activeExperimentId);
  const setActiveExperimentId = useAppStore((state) => state.setActiveExperimentId);
  const activeExperimentTrack = useAppStore((state) => state.activeExperimentTrack);
  const setActiveExperimentTrack = useAppStore((state) => state.setActiveExperimentTrack);
  const [dotStep, setDotStep] = useState(0);
  const dotSequence = ['.', '..', '...'];
  const [visibleSections, setVisibleSections] = useState<Record<TimelineSection, boolean>>({
    innerState: true,
    thought: true,
    speech: true,
    stance: true,
  });

  const agentNameMap = resolveAgentNameMap(agents);
  const sectionOptions: Array<{ key: TimelineSection; label: string }> = [
    { key: 'innerState', label: '内在状态' },
    { key: 'thought', label: '思考摘要' },
    { key: 'speech', label: '发言内容' },
    { key: 'stance', label: '立场刻度' },
  ];

  const handleSectionToggle = (key: TimelineSection) => {
    setVisibleSections((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleStart = async () => {
    try {
        await startConversation();
      } catch (error) {
        console.error('Failed to start conversation', error);
      }
  };

  const handleStartExperiment = async () => {
    try {
      await startPersonaTraversalExperiment();
    } catch (error) {
      console.error('Failed to start experiment', error);
    }
  };

  const handleStopExperiment = () => {
    stopPersonaTraversalExperiment();
  };

  const handleStop = () => {
    stopConversation();
  };

  const isRunning = status.phase === 'running';
  const stopConversationDisabled = !isRunning;

  useEffect(() => {
    if (!status.awaitingLabel) {
      setDotStep(0);
      return;
    }
    const interval = window.setInterval(() => {
      setDotStep((prev) => (prev + 1) % dotSequence.length);
    }, 600);
    return () => {
      window.clearInterval(interval);
    };
  }, [status.awaitingLabel]);

  const waitingText = status.awaitingLabel === 'thinking' ? '等待LLM思考' : '等待LLM响应';
  const experimentEnabled = Boolean(runConfig.personaTraversalExperiment?.enabled);
  const canStartExperiment = experimentEnabled && agents.length === 2;
  const [viewMode, setViewMode] = useState<'conversation' | 'experimentTrack'>('conversation');
  const selectedExperiment = useMemo(() => {
    if (experiments.length === 0) return undefined;
    if (activeExperimentId) {
      const found = experiments.find((exp) => exp.id === activeExperimentId);
      if (found) return found;
    }
    return experiments[0];
  }, [experiments, activeExperimentId]);
  const selectedExperimentResult = selectedExperiment?.result;
  const trackProgress = selectedExperiment?.trackProgress ?? [];
  const trackLiveMessages = selectedExperiment?.trackLiveMessages ?? {};
  const experimentKind = selectedExperimentResult?.config.kind ?? 'big5_grid';
  const [agentAId, agentBId] = selectedExperimentResult?.config.agentIds ?? ['', ''];
  const stanceScaleSize =
    selectedExperiment?.runConfigSnapshot.discussion.stanceScaleSize ?? runConfig.discussion.stanceScaleSize;
  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);
  const traitOptions: Big5TraitKey[] =
    experimentKind === 'big5_grid' && 'dimensions' in (selectedExperimentResult?.config ?? {})
      ? (selectedExperimentResult?.config.dimensions ?? [])
      : [];
  const levelOptions: number[] =
    experimentKind === 'big5_grid' && 'levels' in (selectedExperimentResult?.config ?? {})
      ? (selectedExperimentResult?.config.levels ?? [])
      : [];
  const symmetricOptions = Array.from({ length: maxLevel + 1 }, (_, idx) => {
    const k = maxLevel - idx;
    return { a: -k, b: k };
  });

  const resolvedTrackSelector: ExperimentTrackSelector | undefined = useMemo(() => {
    if (!selectedExperimentResult) return undefined;
    if (experimentKind === 'symmetric_initial_stance') {
      const defaultPair = symmetricOptions[0] ?? { a: 0, b: 0 };
      const fallback: ExperimentTrackSelector = {
        kind: 'symmetric_initial_stance',
        agentAInitialStance: defaultPair.a,
        agentBInitialStance: defaultPair.b,
      };
      return activeExperimentTrack ?? fallback;
    }
    const defaultTrait = traitOptions[0];
    const defaultAValue = levelOptions[0];
    const defaultBValue = levelOptions[0];
    if (defaultTrait == null || defaultAValue == null || defaultBValue == null) return undefined;
    const fallback: ExperimentTrackSelector = {
      kind: 'big5_grid',
      trait: defaultTrait,
      agentAValue: defaultAValue,
      agentBValue: defaultBValue,
    };
    return activeExperimentTrack ?? fallback;
  }, [activeExperimentTrack, experimentKind, levelOptions, selectedExperimentResult, symmetricOptions, traitOptions]);
  const selectedTrack = useMemo(() => {
    if (!selectedExperimentResult || !resolvedTrackSelector) return undefined;
    return selectedExperimentResult.tracks.find((track) => matchTrack(track.meta, resolvedTrackSelector));
  }, [selectedExperimentResult, resolvedTrackSelector]);

  const selectedTrackLiveMessages = useMemo(() => {
    if (!resolvedTrackSelector) return undefined;
    const key = trackKeyFromSelector(resolvedTrackSelector);
    return trackLiveMessages[key];
  }, [resolvedTrackSelector, trackLiveMessages]);

  const displayMessages =
    viewMode === 'experimentTrack'
      ? (selectedTrack?.result.messages ?? selectedTrackLiveMessages ?? [])
      : messages;
  const visibleDisplayMessages = displayMessages.filter((message) => message.content !== '__SKIP__');
  const displayAgentNameMap =
    viewMode === 'experimentTrack' && selectedExperiment?.agentsSnapshot
      ? resolveAgentNameMap(selectedExperiment.agentsSnapshot)
      : agentNameMap;

  return (
    <div className="page page--dialogue">
      {selectedExperiment ? (
        <section className="card">
          <header className="card__header">
            <h2>实验轨道进度</h2>
          </header>
          <div className="card__body">
            <div className="grid two-columns">
              <label className="form-field">
                <span>当前实验</span>
                <select value={selectedExperiment.id} onChange={(event) => setActiveExperimentId(event.target.value)}>
                  {experiments.map((exp) => (
                    <option key={exp.id} value={exp.id}>
                      {exp.id} ｜ {exp.name} ｜ {exp.status.phase} ({exp.status.completedTracks}/{exp.status.totalTracks})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div style={{ maxHeight: 180, overflowY: 'auto' }}>
              {trackProgress.map((tp) => {
                const total = Math.max(1, tp.totalMessagesTarget);
                const done = Math.max(0, Math.min(total, tp.completedMessages));
                const ratio = Math.max(0, Math.min(1, done / total));
                const isActive =
                  resolvedTrackSelector &&
                  matchSelector(tp.selector, resolvedTrackSelector);
                const aName = displayAgentNameMap[agentAId] ?? agentAId;
                const bName = displayAgentNameMap[agentBId] ?? agentBId;
                return (
                  <button
                    key={trackKeyFromSelector(tp.selector)}
                    type="button"
                    className={`button ${isActive ? 'primary' : 'secondary'}`}
                    style={{ width: '100%', textAlign: 'left', marginBottom: 8 }}
                    onClick={() => {
                      setViewMode('experimentTrack');
                      setActiveExperimentTrack(tp.selector);
                    }}
                    title="点击进入该轨道"
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span>
                        {formatTrackProgressLabel(tp, aName, bName)}
                      </span>
                      <span>
                        {tp.phase} ({done}/{total})
                      </span>
                    </div>
                    <div
                      style={{
                        marginTop: 6,
                        height: 8,
                        background: '#e6e6e6',
                        borderRadius: 6,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${Math.round(ratio * 100)}%`,
                          height: '100%',
                          background: isActive ? '#2563eb' : '#64748b',
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="form-hint">同屏最多显示约 5 条轨道进度条，滚动可查看其它轨道；点击任意进度条会进入该轨道。</p>
          </div>
        </section>
      ) : null}

      <section className="card">
        <header className="card__header">
          <h2>运行控制台</h2>
            <div className="card__actions">
              <button
                type="button"
                className="button primary"
                onClick={handleStart}
              >
                开始对话
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={handleStop}
                disabled={stopConversationDisabled}
                title="停止对话后再次开始将重新开局"
              >
                停止对话
              </button>
              {canStartExperiment ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={handleStartExperiment}
                  title="启动人格遍历实验（多轨并行）"
                >
                  开始人格遍历实验
                </button>
              ) : null}
              {experiments.length > 0 ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={handleStopExperiment}
                  title="停止人格遍历实验（中止所有在途轨道）"
                >
                  停止人格遍历实验
                </button>
              ) : null}
            <Link to="/" className="button secondary">
              配置
            </Link>
            <Link to="/results" className="button primary">
              结果
            </Link>
          </div>
        </header>
        {experiments.length > 0 ? (
          <div className="run-status-panel">
            <div className="grid two-columns">
              <label className="form-field">
                <span>选择实验 ID</span>
                <select
                  value={activeExperimentId ?? experiments[0]?.id ?? ''}
                  onChange={(event) => setActiveExperimentId(event.target.value)}
                >
                  {experiments.map((exp) => (
                    <option key={exp.id} value={exp.id}>
                      {exp.id} ｜ {exp.name} ｜ {exp.status.phase} ({exp.status.completedTracks}/{exp.status.totalTracks})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {selectedExperiment?.result ? (
              <div className="grid two-columns">
                <label className="form-field">
                  <span>显示模式</span>
                  <select value={viewMode} onChange={(event) => setViewMode(event.target.value as any)}>
                    <option value="conversation">单次对话</option>
                    <option value="experimentTrack">实验轨道</option>
                  </select>
                </label>
                {experimentKind === 'symmetric_initial_stance' ? (
                  <label className="form-field">
                    <span>轨道检索：对称初始立场（{displayAgentNameMap[agentAId] ?? agentAId} / {displayAgentNameMap[agentBId] ?? agentBId}）</span>
                    <select
                      value={
                        resolvedTrackSelector && resolvedTrackSelector.kind === 'symmetric_initial_stance'
                          ? `${resolvedTrackSelector.agentAInitialStance},${resolvedTrackSelector.agentBInitialStance}`
                          : ''
                      }
                      onChange={(event) => {
                        const [aRaw, bRaw] = event.target.value.split(',');
                        setActiveExperimentTrack({
                          kind: 'symmetric_initial_stance',
                          agentAInitialStance: Number(aRaw),
                          agentBInitialStance: Number(bRaw),
                        });
                      }}
                    >
                      {symmetricOptions.map((pair) => (
                        <option key={`${pair.a},${pair.b}`} value={`${pair.a},${pair.b}`}>
                          {displayAgentNameMap[agentAId] ?? agentAId}={pair.a}，{displayAgentNameMap[agentBId] ?? agentBId}={pair.b}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <>
                    <label className="form-field">
                      <span>轨道检索：维度</span>
                      <select
                        value={resolvedTrackSelector && resolvedTrackSelector.kind !== 'symmetric_initial_stance' ? resolvedTrackSelector.trait : ''}
                        onChange={(event) => {
                          const current =
                            resolvedTrackSelector && resolvedTrackSelector.kind !== 'symmetric_initial_stance'
                              ? resolvedTrackSelector
                              : undefined;
                          setActiveExperimentTrack({
                            kind: 'big5_grid',
                            trait: event.target.value as Big5TraitKey,
                            agentAValue: current?.agentAValue ?? levelOptions[0] ?? 50,
                            agentBValue: current?.agentBValue ?? levelOptions[0] ?? 50,
                          });
                        }}
                      >
                        {traitOptions.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      <span>轨道检索：{displayAgentNameMap[agentAId] ?? agentAId} 值</span>
                      <select
                        value={resolvedTrackSelector && resolvedTrackSelector.kind !== 'symmetric_initial_stance' ? resolvedTrackSelector.agentAValue : ''}
                        onChange={(event) => {
                          const current =
                            resolvedTrackSelector && resolvedTrackSelector.kind !== 'symmetric_initial_stance'
                              ? resolvedTrackSelector
                              : undefined;
                          setActiveExperimentTrack({
                            kind: 'big5_grid',
                            trait: current?.trait ?? traitOptions[0]!,
                            agentAValue: Number(event.target.value),
                            agentBValue: current?.agentBValue ?? levelOptions[0] ?? 50,
                          });
                        }}
                      >
                        {levelOptions.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="form-field">
                      <span>轨道检索：{displayAgentNameMap[agentBId] ?? agentBId} 值</span>
                      <select
                        value={resolvedTrackSelector && resolvedTrackSelector.kind !== 'symmetric_initial_stance' ? resolvedTrackSelector.agentBValue : ''}
                        onChange={(event) => {
                          const current =
                            resolvedTrackSelector && resolvedTrackSelector.kind !== 'symmetric_initial_stance'
                              ? resolvedTrackSelector
                              : undefined;
                          setActiveExperimentTrack({
                            kind: 'big5_grid',
                            trait: current?.trait ?? traitOptions[0]!,
                            agentAValue: current?.agentAValue ?? levelOptions[0] ?? 50,
                            agentBValue: Number(event.target.value),
                          });
                        }}
                      >
                        {levelOptions.map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="run-status-panel">
          <div>
            <span className="status-pill">{translatePhase(status.phase)}</span>
            <span className="status-detail">
              轮次：{status.currentRound} ｜ 顺序：{status.currentTurn} ｜ 消息数：{status.totalMessages}
            </span>
          </div>
          {status.error ? <p className="form-hint error">错误：{status.error}</p> : null}
        </div>
        {status.awaitingLabel ? (
          <div className="waiting-indicator">
            {waitingText}
            <span className="waiting-dots">{` ${dotSequence[dotStep]}`}</span>
          </div>
        ) : null}
        <div className="card__body">
            <div className="timeline-filters">
              <span className="timeline-filters__label">显示内容：</span>
              {sectionOptions.map((option) => (
                <label key={option.key} className="timeline-filters__option">
                  <input
                    type="checkbox"
                    checked={visibleSections[option.key]}
                    onChange={() => handleSectionToggle(option.key)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          {viewMode === 'experimentTrack' && !selectedTrack && (!selectedTrackLiveMessages || selectedTrackLiveMessages.length === 0) ? (
            <div className="empty-state">
              <p>当前轨道尚未生成可展示的对话内容（可能仍在排队或运行中）。请稍后再试，或切换到已完成的轨道。</p>
            </div>
          ) : visibleDisplayMessages.length === 0 ? (
            <div className="empty-state">
              <p>当前尚未有对话记录。配置完成后点击“开始对话”即可查看进展。</p>
            </div>
            ) : (
              <ul className="message-timeline">
                {visibleDisplayMessages.map((message) => {
                  const agentName = message.agentName ?? displayAgentNameMap[message.agentId] ?? message.agentId;
                  const stanceValue =
                    typeof message.stance?.score === 'number'
                      ? message.stance.score > 0
                        ? `+${message.stance.score}`
                        : message.stance.score
                      : undefined;
                  return (
                    <li key={message.id} className="message-timeline__item">
                      <header>
                        <span className="badge">{agentName}</span>
                        <span className="timestamp">{new Date(message.ts).toLocaleTimeString()}</span>
                      </header>
                        {visibleSections.innerState ? (
                          <div className="message-inner-state">
                            <span className="message-section-label">内在状态：</span>
                            <p>{message.innerState || '（未记录内在状态）'}</p>
                          </div>
                        ) : null}
                        {visibleSections.thought ? (
                          <div className="message-thought">
                            <span className="message-section-label">思考摘要：</span>
                            <p>{message.thoughtSummary || '（未提供思考摘要）'}</p>
                          </div>
                        ) : null}
                        {visibleSections.speech ? (
                          <div className="message-body">
                            <span className="message-section-label">发言：</span>
                            <p className="message-content">{message.content}</p>
                          </div>
                        ) : null}
                        {visibleSections.stance && message.stance ? (
                        <div className="message-meta">
                          <span className="message-section-label">立场：</span>
                          <span className={`stance-tag ${stanceClass(message.stance.score)}`}>{stanceValue}</span>
                          {message.stance.note ? (
                            <span className="meta-secondary">{message.stance.note}</span>
                          ) : null}
                          </div>
                        ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
        </div>
      </section>
    </div>
  );
}

const translatePhase = (phase: string) => {
  switch (phase) {
    case 'idle':
      return '待机';
    case 'running':
      return '运行中';
    case 'stopping':
      return '停止中';
    case 'completed':
      return '已完成';
    case 'cancelled':
      return '已中断';
    case 'error':
      return '出错';
    case 'paused':
      return '已暂停';
    default:
      return phase;
  }
};

const stanceClass = (score: number) => {
  if (score > 0) return 'stance-positive';
  if (score < 0) return 'stance-negative';
  return 'stance-neutral';
};

const trackKeyFromSelector = (selector: ExperimentTrackSelector): string => {
  if (selector.kind === 'symmetric_initial_stance') {
    return `stance-${selector.agentAInitialStance}-${selector.agentBInitialStance}`;
  }
  return `big5-${selector.trait}-${selector.agentAValue}-${selector.agentBValue}`;
};

const matchSelector = (a: ExperimentTrackSelector, b: ExperimentTrackSelector): boolean => {
  if (a.kind === 'symmetric_initial_stance' || b.kind === 'symmetric_initial_stance') {
    return (
      a.kind === 'symmetric_initial_stance' &&
      b.kind === 'symmetric_initial_stance' &&
      a.agentAInitialStance === b.agentAInitialStance &&
      a.agentBInitialStance === b.agentBInitialStance
    );
  }
  return a.trait === b.trait && a.agentAValue === b.agentAValue && a.agentBValue === b.agentBValue;
};

const matchTrack = (meta: ExperimentTrackMeta, selector: ExperimentTrackSelector): boolean => {
  if (selector.kind === 'symmetric_initial_stance') {
    return (
      meta.kind === 'symmetric_initial_stance' &&
      meta.agentAInitialStance === selector.agentAInitialStance &&
      meta.agentBInitialStance === selector.agentBInitialStance
    );
  }
  return (
    meta.kind === 'big5_grid' &&
    meta.trait === selector.trait &&
    meta.agentAValue === selector.agentAValue &&
    meta.agentBValue === selector.agentBValue
  );
};

const formatTrackProgressLabel = (
  tp: { index: number; selector: ExperimentTrackSelector },
  aName: string,
  bName: string,
) => {
  if (tp.selector.kind === 'symmetric_initial_stance') {
    return `#${tp.index + 1} ｜ 对称初始立场（${aName}=${tp.selector.agentAInitialStance}，${bName}=${tp.selector.agentBInitialStance}）`;
  }
  return `#${tp.index + 1} ｜ ${tp.selector.trait}（${aName}=${tp.selector.agentAValue}，${bName}=${tp.selector.agentBValue}）`;
};
