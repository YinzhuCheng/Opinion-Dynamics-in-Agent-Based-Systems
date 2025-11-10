import type { ChangeEvent } from 'react';
import { useAppStore } from '../../store/useAppStore';

export function MemorySection() {
  const memory = useAppStore((state) => state.runState.config.memory);
  const setMemoryWindowBudget = useAppStore((state) => state.setMemoryWindowBudget);

  const handleBudgetChange = (event: ChangeEvent<HTMLInputElement>) => {
    setMemoryWindowBudget(Number(event.target.value));
  };

  return (
    <section className="card">
      <header className="card__header">
        <div>
          <h2>记忆管理</h2>
          <p className="card__subtitle">系统默认开启摘要压缩，可调整可见窗口占用的 Token 预算。</p>
        </div>
      </header>
      <div className="card__body column-gap">
        <p className="form-hint">
          系统会在 Token 即将溢出时，对较早的消息进行摘要压缩，并保留近期对话在可见窗口中。摘要仅用于系统提示，不会直接展示给用户。
        </p>
        <div className="memory-slider">
          <label className="form-field">
            <span>可见窗口 Token 预算（占总预算百分比）</span>
            <input
              type="range"
              min={10}
              max={80}
              step={5}
              value={memory.windowTokenBudgetPct}
              onChange={handleBudgetChange}
            />
          </label>
          <div className="memory-slider__value">
            {memory.windowTokenBudgetPct}%&nbsp;用于保留近期消息，剩余 {100 - memory.windowTokenBudgetPct}% 用于摘要存储。
          </div>
        </div>
      </div>
    </section>
  );
}
