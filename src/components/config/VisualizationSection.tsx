import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { useAppStore } from '../../store/useAppStore';

export function VisualizationSection() {
  const [collapsed, setCollapsed] = useState(false);
  const enableStanceChart = useAppStore((state) => state.runState.config.visualization.enableStanceChart);
  const updateRunConfig = useAppStore((state) => state.updateRunConfig);

  const handleToggle = (event: ChangeEvent<HTMLInputElement>) => {
    updateRunConfig((config) => ({
      ...config,
      visualization: {
        ...config.visualization,
        enableStanceChart: event.target.checked,
      },
    }));
  };

  return (
    <section className={`card ${collapsed ? 'card--collapsed' : ''}`}>
      <header className="card__header">
        <div>
          <h2>结果可视化</h2>
          <p className="card__subtitle">配置是否生成观点演化曲线及相关导出。</p>
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
      <div className="card__body column-gap">
        <label className="form-field checkbox-field">
          <span>启用观点演化曲线</span>
          <div className="checkbox-description">
            <input type="checkbox" checked={enableStanceChart} onChange={handleToggle} />
            <p className="form-hint">
              勾选后，在结果页将基于每条消息的立场评分绘制折线图，可导出 PNG/SVG。未勾选则仅进行情感分类。
            </p>
          </div>
        </label>
      </div>
    </section>
  );
}
