import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export function DialoguePage() {
  const { messages, agents } = useAppStore((state) => state.runState);

  return (
    <div className="page page--dialogue">
      <section className="card">
        <header className="card__header">
          <h2>实时对话流</h2>
          <div className="card__actions">
            <Link to="/" className="button secondary">
              返回配置
            </Link>
            <Link to="/results" className="button primary">
              查看结果
            </Link>
          </div>
        </header>
        <div className="card__body">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>当前尚未有对话记录。配置完成后点击“开始对话”即可查看进展。</p>
            </div>
          ) : (
            <ul className="message-timeline">
              {messages.map((message) => {
                const agent = agents.find((a) => a.id === message.agentId);
                return (
                  <li key={message.id} className="message-timeline__item">
                    <header>
                      <span className="badge">{agent?.name ?? 'N/A'}</span>
                      <span className="timestamp">{new Date(message.ts).toLocaleTimeString()}</span>
                    </header>
                    <p className="message-content">{message.content}</p>
                    {message.sentiment && (
                      <div className="message-meta">
                        情感标签：{message.sentiment.label}
                        {typeof message.sentiment.confidence === 'number'
                          ? `（置信度 ${message.sentiment.confidence.toFixed(2)}）`
                          : null}
                      </div>
                    )}
                    {message.stance && (
                      <div className="message-meta">
                        立场强度：{message.stance.score.toFixed(2)}
                        {message.stance.note ? `｜${message.stance.note}` : null}
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
