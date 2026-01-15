import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { Link } from 'react-router-dom';

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

type TrackMetaRow = {
  trackIndex: number;
  trait: string;
  agentAName: string;
  agentBName: string;
  agentAValue: number;
  agentBValue: number;
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
  dSeries?: Array<{ round: number; d: number }>;
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

const computeTrackOutcome = (
  rows: StanceLongRow[],
  meta: TrackMetaRow | undefined,
  params: AnalysisParams,
): TrackAnalysis => {
  const trackIndex = meta?.trackIndex ?? (rows[0]?.trackIndex ?? 1);
  const label =
    meta
      ? `#${meta.trackIndex}｜${meta.trait}（${meta.agentAName}=${meta.agentAValue}，${meta.agentBName}=${meta.agentBValue}）`
      : `#${trackIndex}`;

  // Determine A1/A2 (only 2 agents allowed).
  const agentNameSet = Array.from(new Set(rows.map((r) => r.agentName)));
  if (meta) {
    // Ensure meta names exist in rows.
    if (!agentNameSet.includes(meta.agentAName) || !agentNameSet.includes(meta.agentBName)) {
      return {
        trackIndex,
        label,
        outcome: '未达成一致',
        stable: false,
        error: '非法输入：该轨道的 stance_long 中未找到 tracks 表里的 agentA/agentB 名称。',
      };
    }
  }
  if (agentNameSet.length !== 2) {
    return {
      trackIndex,
      label,
      outcome: '未达成一致',
      stable: false,
      error: `非法输入：只支持 2 个 agent，但检测到 ${agentNameSet.length} 个（${agentNameSet.join(', ')}）。`,
    };
  }
  const [a1Name, a2Name] = meta ? [meta.agentAName, meta.agentBName] : agentNameSet.sort();

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

  // Require full window present.
  for (let t = windowStart; t <= maxRound; t += 1) {
    if (!m1.has(t) || !m2.has(t)) {
      return {
        trackIndex,
        label,
        outcome: '未达成一致',
        stable: false,
        error: `数据不足：最后 k=${k} 轮（${windowStart}..${maxRound}）存在缺失立场分数，无法判定稳定一致。`,
      };
    }
  }

  let maxDInWindow = 0;
  for (let t = windowStart; t <= maxRound; t += 1) {
    const d = Math.abs((m1.get(t)!.stanceScore ?? 0) - (m2.get(t)!.stanceScore ?? 0));
    maxDInWindow = Math.max(maxDInWindow, d);
  }
  const stable = maxDInWindow <= epsilon;
  if (!stable) {
    return { trackIndex, label, outcome: '未达成一致', stable, maxDInWindow, dSeries };
  }

  // Stable post-stances: mean over last k rounds.
  let sum1 = 0;
  let sum2 = 0;
  for (let t = windowStart; t <= maxRound; t += 1) {
    sum1 += m1.get(t)!.stanceScore;
    sum2 += m2.get(t)!.stanceScore;
  }
  const x1_post = sum1 / k;
  const x2_post = sum2 / k;

  // Initial stances are x_i(1) = stance at round 1.
  if (!m1.has(1) || !m2.has(1)) {
    return {
      trackIndex,
      label,
      outcome: '未达成一致',
      stable: false,
      error: '数据不足：缺少第 1 轮立场分数，无法计算变化量与说服/趋同判别。',
    };
  }
  const x1_1 = m1.get(1)!.stanceScore;
  const x2_1 = m2.get(1)!.stanceScore;
  const delta1 = x1_post - x1_1;
  const delta2 = x2_post - x2_1;
  const denom = Math.abs(delta1) + Math.abs(delta2);
  const r1 = denom > 0 ? Math.abs(delta1) / denom : 0.5;
  const r2 = denom > 0 ? Math.abs(delta2) / denom : 0.5;

  // Mapping to "A1说服A2 / A2说服A1 / 相互趋同" (A1=agentA, A2=agentB).
  let outcome: ProcessingOutcome = '相互趋同';
  if (r1 >= tau && r2 < tau) {
    outcome = 'A2说服A1';
  } else if (r2 >= tau && r1 < tau) {
    outcome = 'A1说服A2';
  } else {
    outcome = '相互趋同';
  }

  return {
    trackIndex,
    label,
    outcome,
    stable,
    maxDInWindow,
    dSeries,
    x1_1,
    x2_1,
    x1_post,
    x2_post,
    delta1,
    delta2,
    r1,
    r2,
  };
};

export function DataProcessingPage() {
  const [fileName, setFileName] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [stanceRows, setStanceRows] = useState<StanceLongRow[]>([]);
  const [trackMeta, setTrackMeta] = useState<TrackMetaRow[]>([]);

  const [params, setParams] = useState<AnalysisParams>({
    epsilon: 1,
    k: 5,
    tau: 0.55,
  });

  const handleFile = async (file?: File) => {
    setError('');
    setFileName(file?.name ?? '');
    setStanceRows([]);
    setTrackMeta([]);
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const stanceSheet =
        wb.Sheets['stance_long'] ??
        wb.Sheets['stance-long'] ??
        wb.Sheets['stance'] ??
        undefined;
      if (!stanceSheet) {
        throw new Error('未找到工作表：stance_long。请上传导出的 stance.xlsx 或 experiment_summary.xlsx。');
      }
      const rawStance = XLSX.utils.sheet_to_json<Record<string, unknown>>(stanceSheet, { defval: '' });
      const normalized = rawStance
        .map((row) => normalizeStanceLongRow(row))
        .filter((row): row is StanceLongRow => Boolean(row));
      if (normalized.length === 0) {
        throw new Error('stance_long 中未解析到有效数据行。');
      }
      setStanceRows(normalized);

      const tracksSheet = wb.Sheets['tracks'];
      if (tracksSheet) {
        const rawTracks = XLSX.utils.sheet_to_json<Record<string, unknown>>(tracksSheet, { defval: '' });
        const metas: TrackMetaRow[] = rawTracks
          .map((r) => {
            const trackIndex = asNumber(r.trackIndex ?? r['trackIndex'] ?? r['track'] ?? r['轨道']);
            const trait = (r.trait ?? r['trait'] ?? r['维度'] ?? 'unknown') as string;
            const agentAName = String(r.agentAName ?? r['agentAName'] ?? r['A1'] ?? r['agentA']);
            const agentBName = String(r.agentBName ?? r['agentBName'] ?? r['A2'] ?? r['agentB']);
            const agentAValue = asNumber(r.agentAValue ?? r['agentAValue']);
            const agentBValue = asNumber(r.agentBValue ?? r['agentBValue']);
            if (!trackIndex || !agentAName || !agentBName || agentAValue == null || agentBValue == null) return null;
            return {
              trackIndex: Math.floor(trackIndex),
              trait: String(trait),
              agentAName,
              agentBName,
              agentAValue,
              agentBValue,
            };
          })
          .filter((x): x is TrackMetaRow => Boolean(x));
        setTrackMeta(metas);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const analyses = useMemo(() => {
    if (stanceRows.length === 0) return [];
    const hasTrackIndex = stanceRows.some((r) => typeof r.trackIndex === 'number' && Number.isFinite(r.trackIndex));
    if (!hasTrackIndex) {
      // single conversation stance.xlsx
      return [computeTrackOutcome(stanceRows, undefined, params)];
    }
    const grouped = groupBy(stanceRows, (r) => String(r.trackIndex ?? 'unknown'));
    const metaByIndex = trackMeta.reduce<Record<string, TrackMetaRow>>((acc, m) => {
      acc[String(m.trackIndex)] = m;
      return acc;
    }, {});
    return Object.entries(grouped)
      .map(([key, rows]) => computeTrackOutcome(rows, metaByIndex[key], params))
      .sort((a, b) => a.trackIndex - b.trackIndex);
  }, [params, stanceRows, trackMeta]);

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
            输入：导出的 <code>stance.xlsx</code>（单次对话/单轨道）或 <code>experiment_summary.xlsx</code>（实验汇总）。
            仅支持 2 个 Agent；否则视为非法输入。
          </p>

          <label className="form-field">
            <span>上传 Excel</span>
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {fileName ? <p className="form-hint">当前文件：{fileName}</p> : null}
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
                      <th>Δ1 / Δ2</th>
                      <th>r1 / r2</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analyses.map((a) => (
                      <tr key={a.trackIndex}>
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

