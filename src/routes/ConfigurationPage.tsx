import { Link } from 'react-router-dom';
import { RunSettingsSection } from '../components/config/RunSettingsSection';
import { AgentListSection } from '../components/config/AgentListSection';
import { SentimentSection } from '../components/config/SentimentSection';
import { useAppStore } from '../store/useAppStore';

export function ConfigurationPage() {
  const resetRunState = useAppStore((state) => state.resetRunState);
  const runConfig = useAppStore((state) => state.runState.config);
  const agents = useAppStore((state) => state.runState.agents);

  return (
    <div className="page page--configuration">
      <RunSettingsSection />
      <AgentListSection />
      <SentimentSection />

      <section className="card">
        <header className="card__header">
          <div>
            <h2>准备就绪</h2>
            <p className="card__subtitle">
              当前配置：{runConfig.mode === 'round_robin' ? '轮询模式' : '自由模式'}，Agent 数量 {agents.length} 个。
            </p>
          </div>
          <div className="card__actions">
            <button type="button" className="button ghost" onClick={resetRunState}>
              重置全部
            </button>
            <Link to="/dialogue" className="button primary">
              前往对话
            </Link>
          </div>
        </header>
        <div className="card__body">
          <p className="form-hint">
            点击“前往对话”后，可在对话页启动多 Agent 讨论。对话过程中仍可返回此页调整配置。
          </p>
        </div>
      </section>
    </div>
  );
}
