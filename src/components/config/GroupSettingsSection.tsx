import { useEffect, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';

function buildScaleValues(size: number): number[] {
  const normalized = size % 2 === 0 ? size + 1 : size;
  const half = Math.max(1, Math.floor(normalized / 2));
  const values: number[] = [];
  for (let i = -half; i <= half; i += 1) {
    values.push(i);
  }
  return values;
}

export function GroupSettingsSection() {
  const stanceScaleSize = useAppStore((state) => state.runState.config.discussion.stanceScaleSize);
  const configureAgentGroup = useAppStore((state) => state.configureAgentGroup);
  const scaleValues = buildScaleValues(stanceScaleSize);
  const [counts, setCounts] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    scaleValues.forEach((value) => {
      initial[value] = 0;
    });
    return initial;
  });

  useEffect(() => {
    setCounts((prev) => {
      const next: Record<number, number> = {};
      buildScaleValues(stanceScaleSize).forEach((value) => {
        next[value] = prev[value] ?? 0;
      });
      return next;
    });
  }, [stanceScaleSize]);

  const handleCountChange = (value: number, raw: string) => {
    const numeric = Math.max(0, Math.min(50, Math.floor(Number(raw) || 0)));
    setCounts((prev) => ({
      ...prev,
      [value]: numeric,
    }));
  };

  const handleApply = () => {
    const distribution: Record<number, number> = {};
    let total = 0;
    scaleValues.forEach((value) => {
      const count = Math.max(0, Math.floor(counts[value] ?? 0));
      distribution[value] = count;
      total += count;
    });
    if (total === 0) {
      window.alert('请至少为一个立场标签输入人数。');
      return;
    }
    configureAgentGroup(distribution);
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
        <div className="grid stance-count-grid">
          {scaleValues.map((value) => (
            <label key={value} className="form-field">
              <span>立场标签 {value > 0 ? `+${value}` : value}</span>
              <input
                type="number"
                min={0}
                max={50}
                value={counts[value] ?? 0}
                onChange={(event) => handleCountChange(value, event.target.value)}
              />
            </label>
          ))}
        </div>
        <p className="form-hint">
          小提示：系统会按填写的立场人数自动生成 Agent，总数为所有标签人数之和；未填写的标签默认 0。
        </p>
        <button type="button" className="button primary" onClick={handleApply}>
          应用群体设置
        </button>
      </div>
    </section>
  );
}
