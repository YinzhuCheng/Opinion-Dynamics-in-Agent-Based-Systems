import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export function ResultsPage() {
  const result = useAppStore((state) => state.currentResult);
  const runState = useAppStore((state) => state.runState);

  return (
    <div className="page page--results">
      <section className="card">
        <header className="card__header">
          <h2>对话结果回顾</h2>
          <div className="card__actions">
            <Link to="/" className="button secondary">
              返回配置
            </Link>
            <Link to="/dialogue" className="button primary">
              回到对话
            </Link>
          </div>
        </header>
        <div className="card__body">
          {result ? (
            <div className="results-summary">
              <p>
                已完成会话，结束时间：{new Date(result.finishedAt).toLocaleString()}。共计{' '}
                {result.messages.length} 条消息。
              </p>
              <p>摘要：{result.summary || '尚未生成摘要。'}</p>
            </div>
          ) : (
            <div className="empty-state">
              <p>暂无历史结果。完成一轮对话后将在此展示摘要与导出工具。</p>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <header className="card__header">
          <h2>当前会话状态</h2>
        </header>
        <div className="card__body">
          <p>当前消息数：{runState.messages.length}</p>
          <p>长期摘要长度：{runState.summary.length} 字符</p>
          <p>可见窗口：{runState.visibleWindow.length} 条消息</p>
        </div>
      </section>
    </div>
  );
}
