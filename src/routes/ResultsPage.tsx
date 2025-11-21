import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import * as echarts from 'echarts';
import { useAppStore } from '../store/useAppStore';
import type { Message, SessionResult, RunConfig, FailureRecord } from '../types';
import { resolveAgentNameMap } from '../utils/names';
import {
  ensureNegativeViewpoint,
  ensurePositiveViewpoint,
} from '../constants/discussion';

type ReactEChartsInstance = InstanceType<typeof ReactECharts>;

export function ResultsPage() {
  const result = useAppStore((state) => state.currentResult);
  const runState = useAppStore((state) => state.runState);
  const agentNameMap = resolveAgentNameMap(runState.agents);
  const chartRef = useRef<ReactEChartsInstance | null>(null);
  const [chartTab, setChartTab] = useState<'individual' | 'group'>('individual');
  const liveResult = useMemo<SessionResult | undefined>(() => {
    if (result) {
      return undefined;
    }
    const hasProgress =
      runState.messages.length > 0 ||
      ['running', 'stopping', 'paused'].includes(runState.status.phase);
    if (!hasProgress) {
      return undefined;
    }
    return {
      messages: runState.messages,
      finishedAt: Date.now(),
      summary: runState.summary,
      configSnapshot: runState.config,
      status: runState.status,
        failures: runState.failureRecords,
    };
  }, [result, runState]);
  const displayResult = result ?? liveResult;
  const discussionSnapshot = displayResult?.configSnapshot.discussion;
  const positiveViewpointLabel = ensurePositiveViewpoint(discussionSnapshot?.positiveViewpoint);
  const negativeViewpointLabel = ensureNegativeViewpoint(discussionSnapshot?.negativeViewpoint);

  const stanceDataset = useMemo(() => {
    if (!displayResult) return null;
    return prepareStanceDataset(displayResult, agentNameMap);
  }, [displayResult, agentNameMap]);

  const individualChartOption = useMemo<EChartsOption | null>(() => {
    if (!stanceDataset) return null;
    return buildIndividualStanceChartOption(stanceDataset);
  }, [stanceDataset]);

  const groupChartOption = useMemo<EChartsOption | null>(() => {
    if (!stanceDataset) return null;
    return buildGroupStanceChartOption(stanceDataset);
  }, [stanceDataset]);

  const stanceChartOption = chartTab === 'individual' ? individualChartOption : groupChartOption;

  const handleDownloadTranscript = (mode: 'standard' | 'full') => {
    if (!displayResult) {
      window.alert('暂无可导出的对话。');
      return;
    }
    const text = buildTranscriptText(displayResult, agentNameMap, mode);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const suffix = mode === 'full' ? '-full' : '-standard';
    link.download = `conversation${suffix}-${new Date(displayResult.finishedAt).toISOString().replace(/[:.]/g, '-')}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

    const handleDownloadFailureLog = () => {
      if (!displayResult) {
        window.alert('暂无可导出的对话。');
        return;
      }
      const failures = displayResult.failures ?? [];
      if (failures.length === 0) {
        window.alert('暂无失败记录。');
        return;
      }
      const text = buildFailureLogText(failures);
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const finishedAt = displayResult?.finishedAt ?? Date.now();
      link.download = `failure-log-${new Date(finishedAt).toISOString().replace(/[:.]/g, '-')}.txt`;
      link.click();
      URL.revokeObjectURL(url);
    };

    const handleExportChart = async (chartType: 'individual' | 'group', fileType: 'png' | 'svg') => {
      const option = chartType === 'individual' ? individualChartOption : groupChartOption;
      if (!option) {
        window.alert(
          chartType === 'individual' ? '暂无个体观点曲线可导出。' : '暂无总体观点曲线可导出。',
        );
        return;
      }

      const getDataUrlFromCurrent = () => {
        const instance = chartRef.current?.getEchartsInstance();
        if (!instance) {
          window.alert('图表尚未渲染完成，请稍后再试。');
          return null;
        }
        return instance.getDataURL({
          type: fileType,
          pixelRatio: fileType === 'png' ? 2 : 1,
          backgroundColor: '#fff',
        });
      };

      const getDataUrlFromTemporaryChart = () => {
        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '-9999px';
        container.style.width = '800px';
        container.style.height = '360px';
        container.style.opacity = '0';
        document.body.appendChild(container);
        const renderer = fileType === 'svg' ? 'svg' : 'canvas';
        const instance = echarts.init(container, undefined, { renderer });
        instance.setOption(option, true);
        const dataUrl = instance.getDataURL({
          type: fileType,
          pixelRatio: fileType === 'png' ? 2 : 1,
          backgroundColor: '#fff',
        });
        instance.dispose();
        container.remove();
        return dataUrl;
      };

      const dataUrl =
        chartType === chartTab ? getDataUrlFromCurrent() : getDataUrlFromTemporaryChart();

      if (!dataUrl) {
        return;
      }

      const link = document.createElement('a');
      link.href = dataUrl;
      const finishedAt = displayResult?.finishedAt ?? Date.now();
      const suffix =
        chartType === 'individual' ? 'individual' : 'group';
      link.download = `stance-chart-${suffix}-${new Date(finishedAt)
        .toISOString()
        .replace(/[:.]/g, '-')}.${fileType}`;
      link.click();
    };

  const isFinalized = Boolean(result);
  const summaryLine = displayResult
    ? isFinalized
      ? `已完成会话，结束时间：${new Date(displayResult.finishedAt).toLocaleString()}。共计 ${countVisibleMessages(displayResult.messages)} 条有效消息。`
      : `对话尚未完成（统计截至 ${new Date(displayResult.finishedAt).toLocaleString()}），当前共计 ${countVisibleMessages(displayResult.messages)} 条有效消息。`
    : '';

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
          {displayResult ? (
            <div className="results-summary">
              <p>{summaryLine}</p>
              <p>立场基准：正方 = {positiveViewpointLabel} ｜ 反方 = {negativeViewpointLabel}</p>
              <p>模式：{translateMode(displayResult.configSnapshot.mode)} ｜ 模型配置：{describeModelConfig(displayResult.configSnapshot)}</p>
              <div className="results-actions">
                <button type="button" className="button primary" onClick={() => handleDownloadTranscript('standard')}>
                  下载精简版 .txt
                </button>
                <button type="button" className="button secondary" onClick={() => handleDownloadTranscript('full')}>
                  下载完整版（含提示词）
                </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={handleDownloadFailureLog}
                    disabled={(displayResult?.failures?.length ?? 0) === 0}
                    title="导出失败记录（包含提示词与原始回复）"
                  >
                    下载失败记录 .txt
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => handleExportChart('individual', 'png')}
                    disabled={!individualChartOption}
                    title={
                      individualChartOption
                        ? '导出个体观点演化曲线（PNG）'
                        : '暂无足够的个体曲线数据'
                    }
                  >
                    导出个体观点演化图（PNG）
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => handleExportChart('group', 'png')}
                    disabled={!groupChartOption}
                    title={
                      groupChartOption
                        ? '导出总体观点演化曲线（PNG）'
                        : '暂无足够的总体曲线数据'
                    }
                  >
                    导出总体观点演化图（PNG）
                  </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>暂无历史结果。完成一轮对话或至少生成一条消息后，将在此展示进展与导出工具。</p>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <header className="card__header">
          <h2>观点演化曲线</h2>
        </header>
        <div className="card__body">
          <div className="chart-tab-bar">
            <button
              type="button"
              className={`chart-tab-button ${chartTab === 'individual' ? 'active' : ''}`}
              onClick={() => setChartTab('individual')}
            >
              个体演化曲线
            </button>
            <button
              type="button"
              className={`chart-tab-button ${chartTab === 'group' ? 'active' : ''}`}
              onClick={() => setChartTab('group')}
            >
              总体演化曲线
            </button>
          </div>
          {stanceChartOption ? (
            <>
              <ReactECharts ref={chartRef} option={stanceChartOption} notMerge={true} style={{ height: 360 }} />
              <p className="form-hint">
                提示：点击上方图例可切换曲线可见性，导出 PNG 将保留当前选项卡及显示状态。
              </p>
            </>
          ) : (
            <div className="empty-state">
              <p>暂无可绘制的立场分数。完成至少一条包含“（立场：X）”的发言后即可生成曲线。</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

const translateMode = (mode: string) =>
  mode === 'sequential' ? '依次发言' : '随机顺序发言';

const describeModelConfig = (config: RunConfig): string => {
  if (config.useGlobalModelConfig && config.globalModelConfig) {
    const global = config.globalModelConfig;
    return `${global.vendor}｜${global.model}`;
  }
  return '已启用自由配置';
};

const countVisibleMessages = (messages: Message[]) =>
  messages.filter((message) => message.content !== '__SKIP__').length;

type IndividualStancePoint = { round: number; value: number; message: Message };
type IndividualStanceSeries = { agentId: string; agentName: string; points: IndividualStancePoint[] };
type GroupStancePoint = { round: number; mean: number; variance: number };

interface StanceDataset {
  perAgentSeries: IndividualStanceSeries[];
  groupSeries: GroupStancePoint[];
  maxLevel: number;
  maxRound: number;
}

const prepareStanceDataset = (
  result: SessionResult,
  agentNameMap: Record<string, string>,
): StanceDataset | null => {
  const maxLevel = Math.floor(Math.max(3, result.configSnapshot.discussion.stanceScaleSize) / 2);
  const perAgent = new Map<string, Map<number, { value: number; message: Message }>>();
  let maxRound = 0;
  for (const message of result.messages) {
    if (message.content === '__SKIP__' || typeof message.stance?.score !== 'number') continue;
    maxRound = Math.max(maxRound, message.round);
    if (!perAgent.has(message.agentId)) {
      perAgent.set(message.agentId, new Map());
    }
    perAgent.get(message.agentId)!.set(message.round, { value: message.stance.score, message });
  }
  if (maxRound === 0) return null;
  const perAgentSeries: IndividualStanceSeries[] = Array.from(perAgent.entries())
    .map(([agentId, roundMap]) => ({
      agentId,
      agentName: agentNameMap[agentId] ?? agentId,
      points: Array.from(roundMap.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([round, detail]) => ({ round, value: detail.value, message: detail.message })),
    }))
    .filter((series) => series.points.length > 0);
  if (perAgentSeries.length === 0) return null;

  const groupSeries: GroupStancePoint[] = [];
  for (let round = 1; round <= maxRound; round += 1) {
    const roundValues: number[] = [];
    perAgentSeries.forEach((series) => {
      const point = series.points.find((entry) => entry.round === round);
      if (point) {
        roundValues.push(point.value);
      }
    });
    if (roundValues.length === 0) continue;
    const mean = roundValues.reduce((sum, value) => sum + value, 0) / roundValues.length;
    const variance =
      roundValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / roundValues.length;
    groupSeries.push({ round, mean, variance });
  }

  return {
    perAgentSeries,
    groupSeries,
    maxLevel,
    maxRound,
  };
};

const buildIndividualStanceChartOption = (dataset: StanceDataset): EChartsOption => {
  const { perAgentSeries, maxLevel, maxRound } = dataset;
  const legendData = perAgentSeries.map((series) => series.agentName);
  const series = perAgentSeries.map((series) => ({
    type: 'line' as const,
    name: series.agentName,
    smooth: true,
    symbol: 'circle',
    symbolSize: 8,
    emphasis: { focus: 'series' as const },
    data: series.points.map((point) => ({
      value: [point.round, point.value],
      message: point.message,
    })),
  }));

  return {
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return '';
          return params
            .map((item) => {
              const data = item.data as { value: [number, number]; message?: Message };
              const note = data.message?.stance?.note;
              return [
                `<div>${item.marker}<strong>${item.seriesName}</strong></div>`,
                `<div>轮次：第 ${data.value[0]} 轮 ｜ 立场：${data.value[1].toFixed(2)}</div>`,
                note ? `<div>备注：${escapeHtml(note)}</div>` : '',
              ]
                .filter(Boolean)
                .join('');
            })
            .join('<hr/>');
        },
      },
    legend:
      legendData.length > 0
        ? { type: 'scroll' as const, data: legendData, top: 0 }
        : undefined,
    grid: { left: 40, right: 24, top: legendData.length > 0 ? 65 : 35, bottom: 40 },
    xAxis: {
      type: 'value',
      min: 1,
      max: Math.max(maxRound, 1),
      interval: 1,
      name: '轮次',
      axisLabel: {
        formatter: (value: number) => `第${value}轮`,
      },
    },
    yAxis: {
      type: 'value',
      min: -maxLevel,
      max: maxLevel,
      name: '立场强度',
    },
    series,
  };
};

const buildGroupStanceChartOption = (dataset: StanceDataset): EChartsOption | null => {
  const { groupSeries, maxLevel, maxRound } = dataset;
  if (groupSeries.length === 0) return null;
  const varianceMax =
    groupSeries.length > 0 ? Math.max(...groupSeries.map((point) => point.variance)) : 1;
  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return '';
        return params
          .map((item) => {
            const [round, value] = item.value as [number, number];
            const label = item.seriesName === '平均立场' ? value.toFixed(2) : value.toFixed(3);
            return `<div>${item.marker}<strong>${item.seriesName}</strong> ｜ 轮次：第 ${round} 轮 ｜ 值：${label}</div>`;
          })
          .join('<br/>');
      },
    },
    legend: { data: ['平均立场', '立场方差'], top: 0 },
    grid: { left: 48, right: 40, top: 65, bottom: 40 },
    xAxis: {
      type: 'value',
      min: 1,
      max: Math.max(maxRound, 1),
      interval: 1,
      name: '轮次',
      axisLabel: { formatter: (value: number) => `第${value}轮` },
    },
    yAxis: [
      {
        type: 'value',
        min: -maxLevel,
        max: maxLevel,
        name: '平均立场',
      },
      {
        type: 'value',
        position: 'right',
        min: 0,
        max: Math.max(varianceMax, 1),
        name: '立场方差',
      },
    ],
    series: [
      {
        name: '平均立场',
        type: 'line' as const,
        smooth: true,
        symbol: 'circle',
        symbolSize: 8,
        data: groupSeries.map((point) => [point.round, Number(point.mean.toFixed(2))]),
      },
      {
        name: '立场方差',
        type: 'line' as const,
        yAxisIndex: 1,
        smooth: true,
        symbol: 'diamond',
        symbolSize: 8,
        lineStyle: { type: 'dashed' },
        data: groupSeries.map((point) => [point.round, Number(point.variance.toFixed(3))]),
      },
    ],
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
    lines.push('观点曲线：默认启用');
  const discussion = result.configSnapshot.discussion;
    const positiveView = ensurePositiveViewpoint(discussion?.positiveViewpoint);
    const negativeView = ensureNegativeViewpoint(discussion?.negativeViewpoint);
      lines.push(`正方观点：${positiveView}`);
      lines.push(`反方观点：${negativeView}`);
    if (discussion) {
      lines.push(`立场刻度粒度：${discussion.stanceScaleSize}（范围 ±${Math.floor(discussion.stanceScaleSize / 2)}）`);
    }
  lines.push('');
  lines.push('【对话记录】');
  result.messages.forEach((message, idx) => {
    const agentName = agentNameMap[message.agentId] ?? message.agentId;
    const timestamp = new Date(message.ts).toLocaleTimeString();
    lines.push(`#${idx + 1} ${agentName} @ ${timestamp}${message.content === '__SKIP__' ? '（跳过）' : ''}`);
    if (message.content !== '__SKIP__') {
        if (mode === 'full') {
          lines.push('[System Prompt]');
          lines.push(message.systemPrompt ?? '（无）');
          lines.push('[User Prompt]');
          lines.push(message.userPrompt ?? '（无）');
          lines.push('[LLM Raw Output]');
          lines.push(message.rawContent ?? message.content);
          if (message.stance) {
            lines.push(
              `[Stance] ${message.stance.score.toFixed(2)}${
                message.stance.note ? `｜${message.stance.note}` : ''
              }`,
            );
          }
        } else {
        if (message.innerState) {
          lines.push(`  内在状态：${message.innerState.replace(/\n/g, '\n  ')}`);
        }
        if (message.thoughtSummary) {
          lines.push(`  思考摘要：${message.thoughtSummary.replace(/\n/g, '\n  ')}`);
        }
        lines.push(message.content);
      }
      if (message.stance && mode !== 'full') {
        lines.push(
          `  立场：${message.stance.score.toFixed(2)}${message.stance.note ? `｜${message.stance.note}` : ''}`,
        );
      }
    }
    lines.push('');
  });
  return lines.join('\n');
};

const buildFailureLogText = (failures: FailureRecord[]): string => {
  const lines: string[] = [];
  lines.push(`失败记录导出时间：${new Date().toLocaleString()}`);
  lines.push(`失败总数：${failures.length}`);
  lines.push('');
  failures.forEach((failure, index) => {
    lines.push(`=== 记录 #${index + 1} ===`);
    lines.push(`Agent：${failure.agentName ?? failure.agentId}`);
    lines.push(`轮次：第 ${failure.round} 轮 ｜ 顺位：第 ${failure.turn} 位`);
    lines.push(`类别：${translateFailureCategory(failure.category)}`);
    lines.push(`原因：${failure.reason}`);
    lines.push(`时间：${new Date(failure.timestamp).toLocaleString()}`);
    if (failure.errorMessage) {
      lines.push(`错误详情：${failure.errorMessage}`);
    }
    lines.push('');
    lines.push('[System Prompt]');
    lines.push(failure.systemPrompt ?? '（无）');
    lines.push('');
    lines.push('[User Prompt]');
    lines.push(failure.userPrompt ?? '（无）');
    lines.push('');
    lines.push('[LLM Raw Output]');
    lines.push(failure.rawOutput ?? '（无原始输出）');
    lines.push('');
    lines.push('----------------------------------------');
    lines.push('');
  });
  return lines.join('\n');
};

const translateFailureCategory = (category: FailureRecord['category']): string => {
  switch (category) {
    case 'response_empty':
      return '输出为空或跳过';
    case 'extraction_missing':
      return '结构提取失败';
    case 'format_correction_failed':
      return '格式校正失败';
    case 'request_error':
      return '请求异常';
    default:
      return '未知异常';
  }
};

const escapeHtml = (content: string) => content.replace(/[&<>"']/g, (char) => htmlEscapes[char]);

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};
