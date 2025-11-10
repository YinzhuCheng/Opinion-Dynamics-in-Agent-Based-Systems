import { Link } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';

export function ConfigurationPage() {
  const runState = useAppStore((state) => state.runState);
  const addAgent = useAppStore((state) => state.addAgent);
  const resetRunState = useAppStore((state) => state.resetRunState);

  return (
    <div className="page page--configuration">
      <section className="card">
        <header className="card__header">
          <h2>会话配置摘要</h2>
          <div className="card__actions">
            <button type="button" className="button secondary" onClick={resetRunState}>
              重置
            </button>
            <Link to="/dialogue" className="button primary">
              查看对话
            </Link>
          </div>
        </header>
        <div className="card__body">
          <div className="grid two-columns">
            <div>
              <h3>对话模式</h3>
              <p>
                当前模式：<strong>{runState.config.mode === 'round_robin' ? '轮询' : '自由'}</strong>
              </p>
              {runState.config.mode === 'round_robin' ? (
                <p>最大轮数：{runState.config.maxRounds ?? '未设定'}</p>
              ) : (
                <p>最大消息数：{runState.config.maxMessages ?? '未设定'}</p>
              )}
            </div>
            <div>
              <h3>统一模型配置</h3>
              {runState.config.globalModelConfig ? (
                <ul>
                  <li>供应商：{runState.config.globalModelConfig.vendor}</li>
                  <li>模型：{runState.config.globalModelConfig.model}</li>
                  <li>Temperature：{runState.config.globalModelConfig.temperature ?? '默认'}</li>
                </ul>
              ) : (
                <p>已启用每个 Agent 独立模型配置。</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <header className="card__header">
          <h2>Agent 列表</h2>
          <button type="button" className="button primary" onClick={() => addAgent()}>
            新增 Agent
          </button>
        </header>
        <div className="card__body">
          <ol className="agent-list">
            {runState.agents.map((agent) => (
              <li key={agent.id} className="agent-list__item">
                <div>
                  <h3>{agent.name}</h3>
                  <p>画像类型：{agent.persona.type}</p>
                  {agent.initialOpinion ? <p>初始观点：{agent.initialOpinion}</p> : <p>初始观点：未设定</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
