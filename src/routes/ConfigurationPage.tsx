import { Link } from 'react-router-dom';
import { useRef } from 'react';
import { RunSettingsSection } from '../components/config/RunSettingsSection';
import { AgentListSection } from '../components/config/AgentListSection';
import { useAppStore } from '../store/useAppStore';

export function ConfigurationPage() {
  const resetRunState = useAppStore((state) => state.resetRunState);
  const runConfig = useAppStore((state) => state.runState.config);
  const agents = useAppStore((state) => state.runState.agents);
  const exportConfiguration = useAppStore((state) => state.exportConfiguration);
  const importConfiguration = useAppStore((state) => state.importConfiguration);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleExport = () => {
    const data = exportConfiguration();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `odm-config-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = async (file: File) => {
    const text = await file.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      window.alert('导入失败：不是合法 JSON 文件。');
      return;
    }
    const { applied, warnings } = importConfiguration(json);
    if (!applied) {
      window.alert(warnings.join('\n') || '导入失败：未知原因。');
      return;
    }
    if (warnings.length > 0) {
      window.alert(`导入完成（含提示）：\n${warnings.join('\n')}`);
    } else {
      window.alert('导入完成。');
    }
  };

  return (
    <div className="page page--configuration">
        <RunSettingsSection />
        <AgentListSection />

      <section className="card">
        <header className="card__header">
          <div>
            <h2>准备就绪</h2>
            <p className="card__subtitle">
              当前配置：{runConfig.mode === 'sequential' ? '依次发言' : '随机顺序发言'}，Agent 数量 {agents.length} 个。
            </p>
          </div>
          <div className="card__actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  handleImportFile(file);
                }
                event.target.value = '';
              }}
            />
            <button type="button" className="button secondary" onClick={handleExport}>
              导出配置
            </button>
            <button type="button" className="button secondary" onClick={handleImportClick}>
              导入配置
            </button>
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
