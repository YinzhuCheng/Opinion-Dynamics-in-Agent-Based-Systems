import { useState } from 'react';

export function SentimentSection() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className={`card ${collapsed ? 'card--collapsed' : ''}`}>
      <header className="card__header">
        <div>
          <h2>观点演化图</h2>
          <p className="card__subtitle">
            基于各 Agent 自报的立场分数绘制走势，并在结果页一键导出 PNG。
          </p>
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
          <p className="form-hint">
            系统现已<strong>默认绘制</strong>观点演化曲线，无需手动勾选。只要 Agent
            在发言末尾填写“（情感：X）”，结果页就会自动显示立场折线图，并提供“导出观点演化图（PNG）”按钮。
          </p>
          <p className="form-hint">
            小提示：曲线的颜色与图例一一对应，方便观察不同 Agent 的情绪/立场收敛轨迹。
          </p>
        </div>
      )}
    </section>
  );
}
