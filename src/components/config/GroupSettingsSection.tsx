import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

export function GroupSettingsSection() {
  const stanceScaleSize = useAppStore((state) => state.runState.config.discussion.stanceScaleSize);
  const agents = useAppStore((state) => state.runState.agents);
  const configureAgentGroup = useAppStore((state) => state.configureAgentGroup);
  const [plannedCount, setPlannedCount] = useState<number>(agents.length);
  const [stanceTemplate, setStanceTemplate] = useState('');
  const maxLevel = Math.floor(Math.max(3, stanceScaleSize) / 2);

  useEffect(() => {
    setPlannedCount(agents.length);
  }, [agents.length]);

  const handleApply = () => {
    const safeCount = Math.max(1, Math.min(50, Math.floor(plannedCount || 1)));
    const parsed = stanceTemplate
      .split(/[,，\s]+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => Number(token))
      .filter((value) => Number.isFinite(value))
      .map((value) => Math.max(-maxLevel, Math.min(maxLevel, Math.round(value))));
    configureAgentGroup(safeCount, parsed);
  };

  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2>群体设置</h2>
          <p className="card__subtitle">一次性规划 Agent 数量与整体立场分布，系统会自动生成空白画像。</p>
        </div>
      </header>
      <div className="card__body column-gap">
        <div className="grid two-columns">
          <label className="form-field">
            <span>Agent 总数</span>
            <input
              type="number"
              min={1}
              max={50}
              value={plannedCount}
              onChange={(event) => setPlannedCount(Number(event.target.value) || 1)}
            />
            <p className="form-hint">输入 1-50 的整数，系统将自动命名为 A1、A2…。</p>
          </label>
          <label className="form-field">
            <span>立场分布模板</span>
            <input
              type="text"
              value={stanceTemplate}
              onChange={(event) => setStanceTemplate(event.target.value)}
              placeholder={`例如：+${maxLevel}, +1, 0, -1`}
            />
            <p className="form-hint">
              使用逗号或空格分隔取值，范围必须在 ±{maxLevel} 之间。系统会循环套用到所有 Agent 的初始立场。
            </p>
          </label>
        </div>
        <button type="button" className="button primary" onClick={handleApply}>
          应用群体设置
        </button>
      </div>
    </section>
  );
}
