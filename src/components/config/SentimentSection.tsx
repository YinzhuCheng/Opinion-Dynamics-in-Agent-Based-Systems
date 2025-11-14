import { useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

export function SentimentSection() {
  const [collapsed, setCollapsed] = useState(false);
  const visualization = useAppStore((state) => state.runState.config.visualization);
  const updateRunConfig = useAppStore((state) => state.updateRunConfig);

  const handleVisualizationToggle = (checked: boolean) => {
    updateRunConfig((config) => ({
      ...config,
      visualization: {
        ...config.visualization,
        enableStanceChart: checked,
      },
    }));
  };

  return (
    <section className={`card ${collapsed ? 'card--collapsed' : ''}`}>
      <header className="card__header">
        <div>
          <h2>观点演化图</h2>
          <p className="card__subtitle">基于各 Agent 自报的立场分数绘制走势，并在结果页一键导出 PNG。</p>
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
      {!collapsed && (
        <div className="card__body column-gap">
          <label className="form-field checkbox-field">
            <span>启用观点演化曲线</span>
            <div className="checkbox-description">
              <input
                type="checkbox"
                checked={visualization.enableStanceChart}
                onChange={(event) => handleVisualizationToggle(event.target.checked)}
              />
              <p className="form-hint">
                勾选后，结果页会显示立场折线图，并提供“导出观点演化图（PNG）”按钮一键保存。
              </p>
            </div>
          </label>
          <p className="form-hint">
            立场分数来自各 Agent 在发言末尾自动给出的情绪/态度评分，因此无需再启用额外的情感分类 Agent。
          </p>
        </div>
      )}
    </section>
  );
}
