import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { startConversation, stopConversation } from '../engine/conversationRunner';
import { resolveAgentNameMap } from '../utils/names';

export function DialoguePage() {
  const { messages, agents, status, stopRequested } = useAppStore((state) => state.runState);
  const [isStarting, setIsStarting] = useState(false);
  const visibleMessages = messages.filter((message) => message.content !== '__SKIP__');

  const agentNameMap = resolveAgentNameMap(agents);

  const handleStart = async () => {
    setIsStarting(true);
    try {
      await startConversation();
    } catch (error) {
      console.error('Failed to start conversation', error);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = () => {
    stopConversation();
  };

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
              disabled={isStarting || status.phase === 'running'}
            >
              {isStarting ? '启动中…' : status.phase === 'running' ? '正在运行' : '开始对话'}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={handleStop}
              disabled={status.phase !== 'running' || stopRequested}
            >
              {stopRequested ? '停止中…' : '停止'}
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
        <div className="card__body">
          {visibleMessages.length === 0 ? (
            <div className="empty-state">
              <p>当前尚未有对话记录。配置完成后点击“开始对话”即可查看进展。</p>
            </div>
          ) : (
            <ul className="message-timeline">
              {visibleMessages.map((message) => {
                const agentName = agentNameMap[message.agentId] ?? message.agentId;
                return (
                  <li key={message.id} className="message-timeline__item">
                    <header>
                      <span className="badge">{agentName}</span>
                      <span className="timestamp">{new Date(message.ts).toLocaleTimeString()}</span>
                    </header>
                    <p className="message-content">{message.content}</p>
                    {message.sentiment && (
                      <div className="message-meta">
                        <span className={`sentiment-tag sentiment-${sanitizeLabel(message.sentiment.label)}`}>
                          {message.sentiment.label}
                        </span>
                        {typeof message.sentiment.confidence === 'number' ? (
                          <span className="meta-secondary">
                            置信度 {message.sentiment.confidence.toFixed(2)}
                          </span>
                        ) : null}
                      </div>
                    )}
                    {message.stance && (
                      <div className="message-meta">
                        <span className="meta-primary">立场 {message.stance.score.toFixed(2)}</span>
                        {message.stance.note ? <span className="meta-secondary">{message.stance.note}</span> : null}
                      </div>
                    )}
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
    default:
      return phase;
  }
};

const sanitizeLabel = (label: string) => label.replace(/\s+/g, '-').toLowerCase();
