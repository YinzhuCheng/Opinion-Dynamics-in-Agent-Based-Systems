import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';
import JSZip from 'jszip';

type ProcessingOutcome =
  | '未达成一致'
  | 'A1说服A2'
  | 'A2说服A1'
  | '相互趋同';

type StanceLongRow = {
  trackIndex?: number;
  trait?: string;
  agentAValue?: number;
  agentBValue?: number;
  round: number;
  agentId: string;
  agentName: string;
  stanceScore: number;
  stanceNote?: string;
};

type AnalysisParams = {
  epsilon: number;
  k: number;
  tau: number;
};

type TrackAnalysis = {
  trackIndex: number;
  label: string;
  outcome: ProcessingOutcome;
  stable: boolean;
  maxDInWindow?: number;
  windowCoverage?: string;
  dSeries?: Array<{ round: number; d: number }>;
  agent1Name?: string;
  agent2Name?: string;
  x1_1?: number;
  x2_1?: number;
  x1_post?: number;
  x2_post?: number;
  delta1?: number;
  delta2?: number;
  r1?: number;
  r2?: number;
  error?: string;
};

const asNumber = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

const normalizeStanceLongRow = (raw: Record<string, unknown>): StanceLongRow | null => {
  const round = asNumber(raw.round) ?? asNumber(raw['轮次']) ?? asNumber(raw['t']);
  const agentId = (raw.agentId ?? raw['agentId'] ?? raw['AgentId'] ?? raw['agent_id']) as unknown;
  const agentName = (raw.agentName ?? raw['agentName'] ?? raw['AgentName'] ?? raw['agent_name']) as unknown;
  const stanceScore = asNumber(raw.stanceScore ?? raw['stanceScore'] ?? raw['score'] ?? raw['立场'] ?? raw['立场分数']);
  if (!round || !agentId || !agentName || stanceScore == null) return null;
  return {
    trackIndex: asNumber(raw.trackIndex) ?? asNumber(raw['trackIndex']) ?? asNumber(raw['轨道']) ?? asNumber(raw['track']),
    trait: (raw.trait ?? raw['trait'] ?? raw['维度']) as string | undefined,
    agentAValue: asNumber(raw.agentAValue ?? raw['agentAValue']),
    agentBValue: asNumber(raw.agentBValue ?? raw['agentBValue']),
    round: Math.max(1, Math.floor(round)),
    agentId: String(agentId),
    agentName: String(agentName),
    stanceScore,
    stanceNote: raw.stanceNote ? String(raw.stanceNote) : raw['stanceNote'] ? String(raw['stanceNote']) : undefined,
  };
};

const groupBy = <T,>(items: T[], key: (item: T) => string): Record<string, T[]> => {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {});
};

const parseTrackLabelFromPath = (path: string): { trackIndex: number; label: string } => {
  // Expected parent folder names:
  // - tables/<safeLabel>/stance.xlsx where safeLabel may be "track-<n>-<meta...>" or "conversation-..."
  const parts = path.split('/').filter(Boolean);
  const stanceIdx = parts.findIndex((p) => p.toLowerCase() === 'stance.xlsx');
  const folder = stanceIdx > 0 ? parts[stanceIdx - 1] : parts[parts.length - 2] ?? path;
  const m = folder.match(/^track-(\d+)-(.*)$/i);
  if (m) {
    const n = Number(m[1]);
    const meta = m[2];
    return { trackIndex: Number.isFinite(n) ? n : 1, label: `#${m[1]}｜${meta}` };
  }
  const conv = folder.match(/^conversation-(.*)$/i);
  if (conv) {
    return { trackIndex: 1, label: `conversation｜${conv[1]}` };
  }
  return { trackIndex: 1, label: folder };
};

const orderTwoAgents = (names: string[]): [string, string] => {
  if (names.length !== 2) return [names[0] ?? 'A1', names[1] ?? 'A2'];
  const m0 = names[0].match(/^A(\d+)$/i);
  const m1 = names[1].match(/^A(\d+)$/i);
  if (m0 && m1) {
    const n0 = Number(m0[1]);
    const n1 = Number(m1[1]);
    return n0 <= n1 ? [names[0], names[1]] : [names[1], names[0]];
  }
  return names[0].localeCompare(names[1]) <= 0 ? [names[0], names[1]] : [names[1], names[0]];
};

const computeTrackOutcome = (
  rows: StanceLongRow[],
  params: AnalysisParams,
  labelHint?: { trackIndex: number; label: string },
): TrackAnalysis => {
  // Determine A1/A2 (only 2 agents allowed).
  const agentNameSet = Array.from(new Set(rows.map((r) => r.agentName)));
  const { trackIndex, label } = labelHint ?? { trackIndex: 1, label: '#1' };
  if (agentNameSet.length !== 2) {
    return {
      trackIndex,
      label,
      outcome: '未达成一致',
      stable: false,
      error: `非法输入：只支持 2 个 agent，但检测到 ${agentNameSet.length} 个（${agentNameSet.join(', ')}）。`,
    };
  }
  const [a1Name, a2Name] = orderTwoAgents(agentNameSet);

  const byAgent = groupBy(rows, (r) => r.agentName);
  const pickLastPerRound = (list: StanceLongRow[]) => {
    const m = new Map<number, StanceLongRow>();
    list.forEach((r) => m.set(r.round, r));
    return m;
  };
  const m1 = pickLastPerRound(byAgent[a1Name] ?? []);
  const m2 = pickLastPerRound(byAgent[a2Name] ?? []);

  const rounds = Array.from(new Set(rows.map((r) => r.round))).sort((x, y) => x - y);
  const maxRound = rounds[rounds.length - 1] ?? 0;
  if (maxRound <= 0) {
    return { trackIndex, label, outcome: '未达成一致', stable: false, error: '无有效轮次数据。' };
  }

  const k = Math.max(1, Math.floor(params.k));
  const epsilon = Math.max(0, params.epsilon);
  const tau = Math.min(0.99, Math.max(0.5, params.tau));

  const windowStart = Math.max(1, maxRound - k + 1);
  const dSeries: Array<{ round: number; d: number }> = [];
  for (let t = 1; t <= maxRound; t += 1) {
    const x1 = m1.get(t)?.stanceScore;
    const x2 = m2.get(t)?.stanceScore;
    if (x1 == null || x2 == null) continue;
    dSeries.push({ round: t, d: Math.abs(x1 - x2) });
  }

  let maxDInWindow = 0;
  let windowPairs = 0;
  let sum1 = 0;
  let sum2 = 0;
  for (let t = windowStart; t <= maxRound; t += 1) {
    const x1 = m1.get(t)?.stanceScore;
    const x2 = m2.get(t)?.stanceScore;
    if (x1 == null || x2 == null) continue;
    windowPairs += 1;
    sum1 += x1;
    sum2 += x2;
    maxDInWindow = Math.max(maxDInWindow, Math.abs(x1 - x2));
  }
  const windowCoverage = `${windowPairs}/${k}`;
  const x1_post = windowPairs > 0 ? sum1 / windowPairs : undefined;
  const x2_post = windowPairs > 0 ? sum2 / windowPairs : undefined;
  const stable = windowPairs === k && maxDInWindow <= epsilon;

  // Initial stances are x_i(1) = stance at round 1.
  const x1_1 = m1.get(1)?.stanceScore;
  const x2_1 = m2.get(1)?.stanceScore;
  const delta1 =
    x1_post != null && x1_1 != null ? x1_post - x1_1 : undefined;
  const delta2 =
    x2_post != null && x2_1 != null ? x2_post - x2_1 : undefined;
  const denom =
    delta1 != null && delta2 != null ? Math.abs(delta1) + Math.abs(delta2) : 0;
  const r1 =
    delta1 != null && delta2 != null && denom > 0 ? Math.abs(delta1) / denom : 0.5;
  const r2 =
    delta1 != null && delta2 != null && denom > 0 ? Math.abs(delta2) / denom : 0.5;

  // Mapping to "A1说服A2 / A2说服A1 / 相互趋同" (A1=agentA, A2=agentB).
  let outcome: ProcessingOutcome = '未达成一致';
  let error: string | undefined;
  if (windowPairs === 0) {
    error = `数据不足：最后 k=${k} 轮（${windowStart}..${maxRound}）缺少可配对的两人立场分数，无法计算 Δ 与一致性。`;
  } else if (x1_post == null || x2_post == null) {
    error = `数据不足：无法计算最后 k=${k} 轮均值。`;
  } else if (x1_1 == null || x2_1 == null) {
    error = '数据不足：缺少第 1 轮立场分数，无法计算 Δ。';
  } else if (!stable) {
    outcome = '未达成一致';
    if (windowPairs !== k) {
      error = `窗口覆盖不足：需要 ${k} 轮，但仅匹配到 ${windowPairs} 轮；Δ 以可用轮次均值近似。`;
    }
  } else {
    // Stable: apply persuasion vs convergence.
    outcome = '相互趋同';
    if (r1 >= tau && r2 < tau) {
      outcome = 'A2说服A1';
    } else if (r2 >= tau && r1 < tau) {
      outcome = 'A1说服A2';
    } else {
      outcome = '相互趋同';
    }
  }

  return {
    trackIndex,
    label,
    outcome,
    stable,
    maxDInWindow,
    dSeries,
    windowCoverage,
    agent1Name: a1Name,
    agent2Name: a2Name,
    x1_1,
    x2_1,
    x1_post,
    x2_post,
    delta1,
    delta2,
    r1: stable ? r1 : undefined,
    r2: stable ? r2 : undefined,
    error,
  };
};

export function DataProcessingPage() {
  const [sourceLabel, setSourceLabel] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [trackInputs, setTrackInputs] = useState<Array<{ id: string; labelHint: { trackIndex: number; label: string }; rows: StanceLongRow[] }>>([]);

  const [params, setParams] = useState<AnalysisParams>({
    epsilon: 1,
    k: 5,
    tau: 0.55,
  });

  const parseStanceLongFromArrayBuffer = (buf: ArrayBuffer): StanceLongRow[] => {
    const wb = XLSX.read(buf, { type: 'array' });
    const stanceSheet =
      wb.Sheets['stance_long'] ??
      wb.Sheets['stance-long'] ??
      wb.Sheets['stance'] ??
      undefined;
    if (!stanceSheet) {
      throw new Error('未找到工作表：stance_long。请上传导出的 stance.xlsx（来自 tables 文件夹）。');
    }
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(stanceSheet, { defval: '' });
    const normalized = raw
      .map((row) => normalizeStanceLongRow(row))
      .filter((row): row is StanceLongRow => Boolean(row));
    if (normalized.length === 0) {
      throw new Error('stance_long 中未解析到有效数据行。');
    }
    return normalized;
  };

  const handleSingleExcel = async (file?: File) => {
    setError('');
    setSourceLabel(file?.name ?? '');
    setTrackInputs([]);
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const rows = parseStanceLongFromArrayBuffer(buf);
      setTrackInputs([{ id: file.name, labelHint: { trackIndex: 1, label: file.name }, rows }]);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDirectory = async (files: FileList | null) => {
    setError('');
    setSourceLabel(files ? `目录（${files.length} files）` : '');
    setTrackInputs([]);
    if (!files || files.length === 0) return;
    try {
      const candidates = Array.from(files).filter((f) => f.name.toLowerCase() === 'stance.xlsx');
      if (candidates.length === 0) {
        throw new Error('目录中未找到 stance.xlsx（请上传 ZIP 解压后的 tables 文件夹）。');
      }
      const parsed: Array<{ id: string; labelHint: { trackIndex: number; label: string }; rows: StanceLongRow[] }> = [];
      for (const file of candidates) {
        const buf = await file.arrayBuffer();
        const rows = parseStanceLongFromArrayBuffer(buf);
        const rel = (file as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? file.name;
        const labelHint = parseTrackLabelFromPath(rel);
        parsed.push({ id: rel, labelHint, rows });
      }
      setTrackInputs(parsed.sort((a, b) => a.labelHint.trackIndex - b.labelHint.trackIndex));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleZip = async (file?: File) => {
    setError('');
    setSourceLabel(file?.name ?? '');
    setTrackInputs([]);
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buf);
      const xlsxPaths = Object.keys(zip.files).filter((p) => p.toLowerCase().endsWith('/stance.xlsx'));
      if (xlsxPaths.length === 0) {
        throw new Error('ZIP 中未找到 tables/**/stance.xlsx。请上传导出的结果 ZIP（包含 tables 文件夹）。');
      }
      const parsed: Array<{ id: string; labelHint: { trackIndex: number; label: string }; rows: StanceLongRow[] }> = [];
      for (const p of xlsxPaths) {
        const fileObj = zip.file(p);
        if (!fileObj) continue;
        const ab = await fileObj.async('arraybuffer');
        const rows = parseStanceLongFromArrayBuffer(ab);
        const labelHint = parseTrackLabelFromPath(p);
        parsed.push({ id: p, labelHint, rows });
      }
      setTrackInputs(parsed.sort((a, b) => a.labelHint.trackIndex - b.labelHint.trackIndex));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const analyses = useMemo(() => {
    if (trackInputs.length === 0) return [];
    return trackInputs.map((t) => computeTrackOutcome(t.rows, params, t.labelHint));
  }, [params, trackInputs]);

  const summary = useMemo(() => {
    const counts = analyses.reduce<Record<ProcessingOutcome, number>>(
      (acc, item) => {
        acc[item.outcome] += 1;
        return acc;
      },
      { 未达成一致: 0, A1说服A2: 0, A2说服A1: 0, 相互趋同: 0 },
    );
    return counts;
  }, [analyses]);

  return (
    <div className="page page--results">
      <section className="card">
        <header className="card__header">
          <h2>数据处理</h2>
          <div className="card__actions">
            <Link to="/results" className="button secondary">
              返回结果页
            </Link>
          </div>
        </header>
        <div className="card__body">
          <p className="form-hint">
            输入：上传导出的结果 <code>.zip</code>（推荐，自动遍历 tables/**/stance.xlsx），或上传解压后的 <code>tables</code> 文件夹（目录上传）。
            也支持单独上传某个 <code>stance.xlsx</code>。仅支持 2 个 Agent；否则视为非法输入。
          </p>

          <label className="form-field">
            <span>上传结果 ZIP（包含 tables 文件夹）</span>
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => handleZip(e.target.files?.[0])}
            />
          </label>

          <label className="form-field">
            <span>上传 tables 文件夹（目录上传，包含多个 stance.xlsx）</span>
            <input
              type="file"
              multiple
              onChange={(e) => handleDirectory(e.target.files)}
              ref={(el) => {
                if (!el) return;
                el.setAttribute('webkitdirectory', '');
                el.setAttribute('directory', '');
              }}
            />
          </label>

          <label className="form-field">
            <span>上传单个 stance.xlsx</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => handleSingleExcel(e.target.files?.[0])}
            />
            {sourceLabel ? <p className="form-hint">当前输入：{sourceLabel}（解析到 {trackInputs.length} 个轨道）</p> : null}
          </label>

          <div className="grid two-columns">
            <label className="form-field">
              <span>一致性阈值 ε</span>
              <input
                type="number"
                min={0}
                step="0.1"
                value={params.epsilon}
                onChange={(e) => setParams((p) => ({ ...p, epsilon: Number(e.target.value) }))}
              />
            </label>
            <label className="form-field">
              <span>窗口长度 k（最后 k 轮）</span>
              <input
                type="number"
                min={1}
                step="1"
                value={params.k}
                onChange={(e) => setParams((p) => ({ ...p, k: Math.max(1, Math.floor(Number(e.target.value))) }))}
              />
            </label>
            <label className="form-field">
              <span>判别阈值 τ（≥0.51）</span>
              <input
                type="number"
                min={0.51}
                max={0.99}
                step="0.01"
                value={params.tau}
                onChange={(e) => setParams((p) => ({ ...p, tau: Number(e.target.value) }))}
              />
              <p className="form-hint">
                若稳定一致：用 \(r_i=|\Delta_i|/(|\Delta_1|+|\Delta_2|)\) 与 τ 判别 “说服 vs 相互趋同”。
              </p>
            </label>
          </div>

          {error ? <p className="form-hint error">错误：{error}</p> : null}

          {analyses.length > 0 ? (
            <>
              <p className="form-hint">
                汇总：未达成一致 {summary['未达成一致']} ｜ A1说服A2 {summary['A1说服A2']} ｜ A2说服A1 {summary['A2说服A1']} ｜ 相互趋同 {summary['相互趋同']}
              </p>
              <div className="results-table">
                <table>
                  <thead>
                    <tr>
                      <th>轨道</th>
                      <th>结论</th>
                      <th>稳定一致</th>
                      <th>max d(t)（窗口内）</th>
                      <th>Δ1 / Δ2（带符号）</th>
                      <th>r1 / r2</th>
                      <th>窗口覆盖</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyses.map((a) => (
                      <tr key={`${a.trackIndex}-${a.label}`}>
                        <td>{a.label}</td>
                        <td>{a.outcome}</td>
                        <td>{a.stable ? '是' : '否'}</td>
                        <td>{a.maxDInWindow != null ? a.maxDInWindow.toFixed(3) : ''}</td>
                        <td>
                          {a.delta1 != null && a.delta2 != null ? `${a.delta1.toFixed(3)} / ${a.delta2.toFixed(3)}` : ''}
                        </td>
                        <td>
                          {a.r1 != null && a.r2 != null ? `${a.r1.toFixed(3)} / ${a.r2.toFixed(3)}` : ''}
                        </td>
                        <td>{a.windowCoverage ?? ''}</td>
                        <td>{a.error ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}

