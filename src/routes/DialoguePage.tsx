import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { refreshConversation, resumeConversation, startConversation, stopConversation } from '../engine/conversationRunner';
import { resolveAgentNameMap } from '../utils/names';

type TimelineSection = 'innerState' | 'thought' | 'speech' | 'stance';

export function DialoguePage() {
  const { messages, agents, status } = useAppStore((state) => state.runState);
  const visibleMessages = messages.filter((message) => message.content !== '__SKIP__');
  const [dotStep, setDotStep] = useState(0);
  const dotSequence = ['.', '..', '...'];
  const [isRefreshing, setIsRefreshing] = useState(false);
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

  const handleStop = () => {
    stopConversation();
  };

  const handleResume = () => {
    resumeConversation();
  };
  const isRunning = status.phase === 'running';
  const isPaused = status.phase === 'paused';
  const hasHistory = messages.length > 0 || status.phase !== 'idle';
  const startLabel = hasHistory ? '重启对话' : '开始对话';
  const stopButtonDisabled = !isRunning && !isPaused;
  const stopButtonLabel = isPaused ? '继续对话' : '停止';
  const canRefresh = hasHistory && status.phase === 'error';
  const refreshButtonText = isRefreshing ? '刷新中…' : '刷新';

  const handleRefresh = async () => {
    if (!canRefresh || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refreshConversation();
    } catch (error) {
      console.error('Failed to refresh conversation', error);
    } finally {
      setIsRefreshing(false);
    }
  };

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

  return (
    <div className="page page--dialogue">
      <section className="card">
        <header className="card__header">
          <h2>实时对话流</h2>
            <div className="card__actions">
              <button
                type="button"
                className="button primary"
                onClick={handleStart}
              >
                {startLabel}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={isPaused ? handleResume : handleStop}
                disabled={stopButtonDisabled}
              >
                {stopButtonLabel}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={handleRefresh}
                disabled={!canRefresh || isRefreshing}
              >
                {refreshButtonText}
              </button>
            <Link to="/" className="button secondary">
              返回配置
            </Link>
            <Link to="/results" className="button primary">
              查看结果
            </Link>
          </div>
        </header>
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
          {visibleMessages.length === 0 ? (
            <div className="empty-state">
              <p>当前尚未有对话记录。配置完成后点击“开始对话”即可查看进展。</p>
            </div>
            ) : (
              <ul className="message-timeline">
                {visibleMessages.map((message) => {
                  const agentName = message.agentName ?? agentNameMap[message.agentId] ?? message.agentId;
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
