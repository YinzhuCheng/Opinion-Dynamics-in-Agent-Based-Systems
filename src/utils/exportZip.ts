import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import type {
  PersonaTraversalExperimentRecord,
  SessionResult,
  ExperimentTrackResult,
} from '../types';
import { resolveAgentNameMap } from './names';

type ZipExportInput = {
  /** Optional: current single conversation result. */
  conversation?: SessionResult;
  /** Optional: experiments list (will traverse all finished tracks). */
  experiments?: PersonaTraversalExperimentRecord[];
};

const timestampId = (ms: number) => new Date(ms).toISOString().replace(/[:.]/g, '-');

const sanitizePathPart = (value: string) =>
  (value || 'unknown')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);

const csvEscape = (value: unknown) => {
  const raw = value == null ? '' : String(value);
  if (raw.includes('"') || raw.includes(',') || raw.includes('\n') || raw.includes('\r')) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
};

const toXlsxArrayBuffer = (workbook: XLSX.WorkBook): ArrayBuffer => {
  const array = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return array;
};

type StanceRow = {
  round: number;
  agentId: string;
  agentName: string;
  stanceScore: number;
  stanceNote?: string;
  messageId: string;
  ts: number;
  turn: number;
};

type GroupRow = {
  round: number;
  mean: number;
  variance: number;
};

const collectStanceRows = (
  session: SessionResult,
  agentNameMap: Record<string, string>,
): { rows: StanceRow[]; maxRound: number; agentIds: string[] } => {
  const perAgent = new Map<string, Map<number, StanceRow>>();
  let maxRound = 0;
  for (const message of session.messages) {
    if (message.content === '__SKIP__') continue;
    if (typeof message.stance?.score !== 'number' || !Number.isFinite(message.stance.score)) continue;
    const round = Math.max(1, message.round || 1);
    maxRound = Math.max(maxRound, round);
    if (!perAgent.has(message.agentId)) perAgent.set(message.agentId, new Map());
    perAgent.get(message.agentId)!.set(round, {
      round,
      agentId: message.agentId,
      agentName: agentNameMap[message.agentId] ?? message.agentName ?? message.agentId,
      stanceScore: Number(message.stance.score),
      stanceNote: message.stance.note,
      messageId: message.id,
      ts: message.ts,
      turn: message.turn,
    });
  }
  const rows: StanceRow[] = [];
  for (const [, roundMap] of perAgent) {
    for (const [, row] of roundMap) {
      rows.push(row);
    }
  }
  rows.sort((a, b) => a.round - b.round || a.agentName.localeCompare(b.agentName));
  const agentIds = Array.from(perAgent.keys()).sort((a, b) => (agentNameMap[a] ?? a).localeCompare(agentNameMap[b] ?? b));
  return { rows, maxRound, agentIds };
};

const buildConversationWorkbook = (
  session: SessionResult,
  agentNameMap: Record<string, string>,
): ArrayBuffer | null => {
  const { rows, maxRound, agentIds } = collectStanceRows(session, agentNameMap);
  if (rows.length === 0 || maxRound === 0) return null;

  const wb = XLSX.utils.book_new();

  // Sheet 1: long format (one row per agent per round)
  const longHeader = [
    'round',
    'agentId',
    'agentName',
    'stanceScore',
    'stanceNote',
    'messageId',
    'ts',
    'turn',
  ];
  const longAoA: (string | number)[][] = [
    longHeader,
    ...rows.map((r) => [
      r.round,
      r.agentId,
      r.agentName,
      r.stanceScore,
      r.stanceNote ?? '',
      r.messageId,
      r.ts,
      r.turn,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(longAoA), 'stance_long');

  // Sheet 2: wide format (one row per round, one column per agent)
  const wideHeader: string[] = ['round'];
  agentIds.forEach((id) => {
    const name = agentNameMap[id] ?? id;
    wideHeader.push(`${name}_score`);
    wideHeader.push(`${name}_note`);
  });
  const stanceByAgentRound = new Map<string, Map<number, StanceRow>>();
  rows.forEach((r) => {
    if (!stanceByAgentRound.has(r.agentId)) stanceByAgentRound.set(r.agentId, new Map());
    stanceByAgentRound.get(r.agentId)!.set(r.round, r);
  });
  const wideAoA: (string | number)[][] = [wideHeader];
  for (let round = 1; round <= maxRound; round += 1) {
    const row: (string | number)[] = [round];
    agentIds.forEach((id) => {
      const item = stanceByAgentRound.get(id)?.get(round);
      row.push(item ? item.stanceScore : '');
      row.push(item ? item.stanceNote ?? '' : '');
    });
    wideAoA.push(row);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(wideAoA), 'stance_by_round');

  return toXlsxArrayBuffer(wb);
};

const computeStanceExports = (
  session: SessionResult,
  agentNameMap: Record<string, string>,
): { individualCsv: string | null; groupCsv: string | null } => {
  const perAgent = new Map<string, Map<number, StanceRow>>();
  let maxRound = 0;

  // Keep the last stance per (agent, round) to match chart behavior.
  for (const message of session.messages) {
    if (message.content === '__SKIP__') continue;
    if (typeof message.stance?.score !== 'number' || !Number.isFinite(message.stance.score)) continue;
    const round = Math.max(1, message.round || 1);
    maxRound = Math.max(maxRound, round);
    if (!perAgent.has(message.agentId)) perAgent.set(message.agentId, new Map());
    perAgent.get(message.agentId)!.set(round, {
      round,
      agentId: message.agentId,
      agentName: agentNameMap[message.agentId] ?? message.agentName ?? message.agentId,
      stanceScore: Number(message.stance.score),
      stanceNote: message.stance.note,
      messageId: message.id,
      ts: message.ts,
      turn: message.turn,
    });
  }

  if (maxRound === 0 || perAgent.size === 0) {
    return { individualCsv: null, groupCsv: null };
  }

  const individualRows: StanceRow[] = [];
  for (const [, roundMap] of perAgent) {
    for (const [, row] of roundMap) {
      individualRows.push(row);
    }
  }
  individualRows.sort((a, b) => a.round - b.round || a.agentName.localeCompare(b.agentName));

  const individualLines = [
    'round,agentId,agentName,stanceScore,stanceNote,messageId,ts,turn',
    ...individualRows.map((row) =>
      [
        row.round,
        csvEscape(row.agentId),
        csvEscape(row.agentName),
        row.stanceScore,
        csvEscape(row.stanceNote ?? ''),
        csvEscape(row.messageId),
        row.ts,
        row.turn,
      ].join(','),
    ),
  ];

  const groupRows: GroupRow[] = [];
  for (let round = 1; round <= maxRound; round += 1) {
    const roundValues: number[] = [];
    perAgent.forEach((roundMap) => {
      const row = roundMap.get(round);
      if (row) roundValues.push(row.stanceScore);
    });
    if (roundValues.length === 0) continue;
    const mean = roundValues.reduce((sum, v) => sum + v, 0) / roundValues.length;
    const variance = roundValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / roundValues.length;
    groupRows.push({
      round,
      mean: Number(mean.toFixed(6)),
      variance: Number(variance.toFixed(6)),
    });
  }

  const groupLines = [
    'round,mean,variance',
    ...groupRows.map((row) => [row.round, row.mean, row.variance].join(',')),
  ];

  return {
    individualCsv: individualLines.join('\n'),
    groupCsv: groupLines.join('\n'),
  };
};

const addConversationToZip = (
  zip: JSZip,
  baseFolder: string,
  label: string,
  session: SessionResult,
  agentNameMap: Record<string, string>,
  payload: unknown,
) => {
  const safeLabel = sanitizePathPart(label);

  // Dialogue record: one file per conversation.
  zip.file(`${baseFolder}/dialogues/${safeLabel}.json`, JSON.stringify(payload, null, 2));

  // Opinion curves: one folder per conversation.
  const curvesBase = `${baseFolder}/opinion_curves/${safeLabel}`;
  const { individualCsv, groupCsv } = computeStanceExports(session, agentNameMap);
  if (individualCsv) {
    zip.file(`${curvesBase}/individual.csv`, individualCsv);
  }
  if (groupCsv) {
    zip.file(`${curvesBase}/group.csv`, groupCsv);
  }

  // Excel tables: stance evolution per round/agent.
  const xlsx = buildConversationWorkbook(session, agentNameMap);
  if (xlsx) {
    zip.file(`${baseFolder}/tables/${safeLabel}/stance.xlsx`, xlsx);
  }
};

const addExperimentTrack = (
  zip: JSZip,
  baseFolder: string,
  experimentId: string,
  track: ExperimentTrackResult,
  agentNameMap: Record<string, string>,
) => {
  const metaLabel =
    track.meta.kind === 'symmetric_initial_stance'
      ? `stance-${track.meta.agentAInitialStance}x${track.meta.agentBInitialStance}`
      : `${track.meta.trait}-${track.meta.agentAValue}x${track.meta.agentBValue}`;
  const trackLabel = `track-${track.meta.index + 1}-${metaLabel}`;
  addConversationToZip(
    zip,
    `${baseFolder}/experiments/${sanitizePathPart(experimentId)}`,
    trackLabel,
    track.result,
    agentNameMap,
    {
      source: 'experiment_track',
      experimentId,
      trackMeta: track.meta,
      session: track.result,
    },
  );
};

const buildExperimentSummaryWorkbook = (
  experiment: PersonaTraversalExperimentRecord,
): ArrayBuffer | null => {
  if (!experiment.result || experiment.result.tracks.length === 0) return null;
  const tracks = experiment.result.tracks;
  const config = experiment.result.config;
  const agentNameMap = resolveAgentNameMap(experiment.agentsSnapshot);

  const wb = XLSX.utils.book_new();

  // Sheet: tracks meta
  const metaHeader = [
    'experimentId',
    'experimentName',
    'experimentKind',
    'trackIndex',
    'trait',
    'agentAId',
    'agentAName',
    'agentAValue',
    'agentBId',
    'agentBName',
    'agentBValue',
    'finishedAt',
    'mode',
    'maxRounds',
    'maxMessages',
    'stanceScaleSize',
    'positiveViewpoint',
    'negativeViewpoint',
  ];
  const metaAoA: (string | number)[][] = [metaHeader];
  tracks.forEach((track) => {
    const aName = agentNameMap[track.meta.agentAId] ?? track.meta.agentAId;
    const bName = agentNameMap[track.meta.agentBId] ?? track.meta.agentBId;
    const trait = track.meta.kind === 'big5_grid' ? track.meta.trait : 'stance';
    const aValue =
      track.meta.kind === 'big5_grid' ? track.meta.agentAValue : track.meta.agentAInitialStance;
    const bValue =
      track.meta.kind === 'big5_grid' ? track.meta.agentBValue : track.meta.agentBInitialStance;
    metaAoA.push([
      experiment.id,
      experiment.name,
      config.kind === 'symmetric_initial_stance' ? 'symmetric_initial_stance' : 'big5_grid',
      track.meta.index + 1,
      trait,
      track.meta.agentAId,
      aName,
      aValue,
      track.meta.agentBId,
      bName,
      bValue,
      track.result.finishedAt,
      experiment.runConfigSnapshot.mode,
      experiment.runConfigSnapshot.maxRounds ?? '',
      experiment.runConfigSnapshot.maxMessages ?? '',
      experiment.runConfigSnapshot.discussion.stanceScaleSize,
      experiment.runConfigSnapshot.discussion.positiveViewpoint,
      experiment.runConfigSnapshot.discussion.negativeViewpoint,
    ]);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(metaAoA), 'tracks');

  // Sheet: stance long (all tracks)
  const stanceHeader = [
    'experimentId',
    'experimentName',
    'experimentKind',
    'trackIndex',
    'trait',
    'agentAValue',
    'agentBValue',
    'round',
    'agentId',
    'agentName',
    'stanceScore',
    'stanceNote',
    'messageId',
    'ts',
    'turn',
  ];
  const stanceAoA: (string | number)[][] = [stanceHeader];
  tracks.forEach((track) => {
    const trait = track.meta.kind === 'big5_grid' ? track.meta.trait : 'stance';
    const aValue =
      track.meta.kind === 'big5_grid' ? track.meta.agentAValue : track.meta.agentAInitialStance;
    const bValue =
      track.meta.kind === 'big5_grid' ? track.meta.agentBValue : track.meta.agentBInitialStance;
    const { rows } = collectStanceRows(track.result, agentNameMap);
    rows.forEach((r) => {
      stanceAoA.push([
        experiment.id,
        experiment.name,
        config.kind === 'symmetric_initial_stance' ? 'symmetric_initial_stance' : 'big5_grid',
        track.meta.index + 1,
        trait,
        aValue,
        bValue,
        r.round,
        r.agentId,
        r.agentName,
        r.stanceScore,
        r.stanceNote ?? '',
        r.messageId,
        r.ts,
        r.turn,
      ]);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stanceAoA), 'stance_long');

  return toXlsxArrayBuffer(wb);
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
};

export async function exportResultsZip({
  conversation,
  experiments,
}: ZipExportInput): Promise<void> {
  const zip = new JSZip();
  const root = `export-${timestampId(Date.now())}`;

  const hasConversation = Boolean(conversation);
  const hasExperiments = Boolean(experiments && experiments.length > 0);
  if (!hasConversation && !hasExperiments) {
    throw new Error('暂无可导出的结果。');
  }

  if (conversation) {
    const mapFromMessages = conversation.messages.reduce<Record<string, string>>((acc, msg) => {
      acc[msg.agentId] = acc[msg.agentId] ?? msg.agentName ?? msg.agentId;
      return acc;
    }, {});

    addConversationToZip(
      zip,
      `${root}/single`,
      `conversation-${timestampId(conversation.finishedAt)}`,
      conversation,
      mapFromMessages,
      { source: 'single_conversation', session: conversation },
    );
  }

  if (experiments && experiments.length > 0) {
    for (const exp of experiments) {
      if (!exp.result || !Array.isArray(exp.result.tracks) || exp.result.tracks.length === 0) {
        continue;
      }
      const expBase = `${root}/experiments/${sanitizePathPart(exp.id)}`;
      zip.file(
        `${expBase}/experiment.json`,
        JSON.stringify(
          {
            id: exp.id,
            name: exp.name,
            createdAt: exp.createdAt,
            status: exp.status,
            agentsSnapshot: exp.agentsSnapshot,
            runConfigSnapshot: exp.runConfigSnapshot,
            result: exp.result,
          },
          null,
          2,
        ),
      );

      const agentNameMap = resolveAgentNameMap(exp.agentsSnapshot);
      exp.result.tracks.forEach((track) => addExperimentTrack(zip, root, exp.id, track, agentNameMap));

      const summaryXlsx = buildExperimentSummaryWorkbook(exp);
      if (summaryXlsx) {
        zip.file(`${expBase}/tables/experiment_summary.xlsx`, summaryXlsx);
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${root}.zip`);
}

