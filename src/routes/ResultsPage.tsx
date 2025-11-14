import { useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useAppStore } from '../store/useAppStore';
import type { Message, SessionResult, RunConfig } from '../types';
import { resolveAgentNameMap } from '../utils/names';

export function ResultsPage() {
  const result = useAppStore((state) => state.currentResult);
  const runState = useAppStore((state) => state.runState);
  const agentNameMap = resolveAgentNameMap(runState.agents);
  const chartRef = useRef<ReactECharts | null>(null);

  const stanceChartOption = useMemo<EChartsOption | null>(() => {
    if (!result?.configSnapshot.visualization.enableStanceChart) return null;
    return buildStanceChartOption(result, agentNameMap);
  }, [result, agentNameMap]);

  const handleDownloadTranscript = (mode: 'standard' | 'full') => {
    if (!result) return;
    const text = buildTranscriptText(result, agentNameMap, mode);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const suffix = mode === 'full' ? '-full' : '-standard';
    link.download = `conversation${suffix}-${new Date(result.finishedAt).toISOString().replace(/[:.]/g, '-')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportChart = (type: 'png' | 'svg') => {
    if (!stanceChartOption) return;
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    const dataUrl = instance.getDataURL({
      type,
      pixelRatio: type === 'png' ? 2 : 1,
      backgroundColor: '#fff',
    });
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `stance-chart-${new Date(result!.finishedAt).toISOString().replace(/[:.]/g, '-')}.${type}`;
    link.click();
  };

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
                {countVisibleMessages(result.messages)} 条有效消息。
              </p>
              <p>摘要：{result.summary || '尚未生成摘要。'}</p>
              <p>模式：{translateMode(result.configSnapshot.mode)} ｜ 模型配置：{describeModelConfig(result.configSnapshot)}</p>
              <div className="results-actions">
                  <button type="button" className="button primary" onClick={() => handleDownloadTranscript('standard')}>
                    下载精简版 .txt
                  </button>
                  <button type="button" className="button secondary" onClick={() => handleDownloadTranscript('full')}>
                    下载完整版（含提示词）
                  </button>
                {stanceChartOption ? (
                  <>
                    <button type="button" className="button secondary" onClick={() => handleExportChart('png')}>
                      导出 PNG
                    </button>
                    <button type="button" className="button secondary" onClick={() => handleExportChart('svg')}>
                      导出 SVG
                    </button>
                  </>
                ) : null}
              </div>
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

      {stanceChartOption ? (
        <section className="card">
          <header className="card__header">
            <h2>观点演化曲线</h2>
          </header>
          <div className="card__body">
            <ReactECharts ref={chartRef} option={stanceChartOption} notMerge={true} style={{ height: 360 }} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

const translateMode = (mode: string) => (mode === 'round_robin' ? '轮询对话' : '自由对话');

const describeModelConfig = (config: RunConfig): string => {
  if (config.useGlobalModelConfig && config.globalModelConfig) {
    const global = config.globalModelConfig;
    return `${global.vendor}｜${global.model}`;
  }
  return '已启用自由配置';
};

const countVisibleMessages = (messages: Message[]) =>
  messages.filter((message) => message.content !== '__SKIP__').length;

const buildStanceChartOption = (result: SessionResult, agentNameMap: Record<string, string>): EChartsOption => {
  const dataByAgent = new Map<string, { name: string; data: Array<{ value: [number, number]; message: Message }> }>();
  let index = 0;
  for (const message of result.messages) {
    if (message.content === '__SKIP__' || typeof message.stance?.score !== 'number') continue;
    index += 1;
    const agentName = agentNameMap[message.agentId] ?? message.agentId;
    if (!dataByAgent.has(message.agentId)) {
      dataByAgent.set(message.agentId, { name: agentName, data: [] });
    }
    dataByAgent.get(message.agentId)!.data.push({ value: [index, message.stance.score], message });
  }

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        return params
          .map((item) => {
            const data = item.data as { value: [number, number]; message: Message };
            const time = new Date(data.message.ts).toLocaleTimeString();
            return [
              `<div>${item.marker}<strong>${item.seriesName}</strong></div>`,
              `<div>消息序号：${data.value[0]} ｜ 时间：${time}</div>`,
              `<div>立场：${data.value[1].toFixed(2)}</div>`,
              data.message.stance?.note ? `<div>说明：${data.message.stance.note}</div>` : '',
              `<div>内容：${escapeHtml(data.message.content)}</div>`,
            ]
              .filter(Boolean)
              .join('');
          })
          .join('<hr/>');
      },
    },
    grid: { left: 40, right: 24, top: 35, bottom: 40 },
    xAxis: {
      type: 'value',
      name: '消息序号',
      min: 1,
    },
    yAxis: {
      type: 'value',
      min: -1,
      max: 1,
      name: '立场强度',
    },
    series: Array.from(dataByAgent.values()).map((series) => ({
      type: 'line',
      name: series.name,
      smooth: true,
      data: series.data,
      symbol: 'circle',
      symbolSize: 8,
      emphasis: {
        focus: 'series',
      },
    })),
  };
};

const buildTranscriptText = (
  result: SessionResult,
  agentNameMap: Record<string, string>,
  mode: 'standard' | 'full' = 'standard',
): string => {
  const lines: string[] = [];
  lines.push(`会话结束时间：${new Date(result.finishedAt).toLocaleString()}`);
  lines.push(`模式：${translateMode(result.configSnapshot.mode)}`);
  if (result.configSnapshot.useGlobalModelConfig && result.configSnapshot.globalModelConfig) {
    const global = result.configSnapshot.globalModelConfig;
    lines.push(`统一模型：${global.vendor}｜${global.model}`);
  } else {
    lines.push('使用自由模型配置');
  }
  lines.push(`情感分类：${result.configSnapshot.sentiment.enabled ? '启用' : '关闭'}`);
  const stanceEnabled = result.configSnapshot.visualization?.enableStanceChart ?? false;
  lines.push(`观点曲线：${stanceEnabled ? '启用' : '关闭'}`);
  const discussion = result.configSnapshot.discussion;
  lines.push(`讨论主题：${discussion?.topic || '（未设置）'}`);
  if (discussion) {
    lines.push(`立场/情感刻度粒度：${discussion.stanceScaleSize}（范围 ±${Math.floor(discussion.stanceScaleSize / 2)}）`);
  }
  lines.push('');
  lines.push('【摘要】');
  lines.push(result.summary || '无摘要');
  lines.push('');
  lines.push('【对话记录】');
  result.messages.forEach((message, idx) => {
    const agentName = agentNameMap[message.agentId] ?? message.agentId;
    const timestamp = new Date(message.ts).toLocaleTimeString();
    lines.push(
      `#${idx + 1} ${agentName} @ ${timestamp}${message.content === '__SKIP__' ? '（跳过）' : ''}`,
    );
    if (message.content !== '__SKIP__') {
      lines.push(message.content);
      if (message.sentiment) {
        lines.push(
          `  情感：${message.sentiment.label}${
            typeof message.sentiment.confidence === 'number'
              ? `（置信度 ${message.sentiment.confidence.toFixed(2)}）`
              : ''
          }`,
        );
      }
      if (message.stance && stanceEnabled) {
        lines.push(
          `  立场：${message.stance.score.toFixed(2)}${message.stance.note ? `｜${message.stance.note}` : ''}`,
        );
      }
      if (mode === 'full') {
        if (message.systemPrompt) {
          lines.push('  [System Prompt]');
          lines.push(`  ${message.systemPrompt.replace(/\n/g, '\n  ')}`);
        }
        if (message.userPrompt) {
          lines.push('  [User Prompt]');
          lines.push(`  ${message.userPrompt.replace(/\n/g, '\n  ')}`);
        }
      }
    }
    lines.push('');
  });
  return lines.join('\n');
};

const escapeHtml = (content: string) => content.replace(/[&<>"']/g, (char) => htmlEscapes[char]);

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
