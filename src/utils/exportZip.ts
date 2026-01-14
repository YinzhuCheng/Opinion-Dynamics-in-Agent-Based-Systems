import JSZip from 'jszip';
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
};

const addExperimentTrack = (
  zip: JSZip,
  baseFolder: string,
  experimentId: string,
  track: ExperimentTrackResult,
  agentNameMap: Record<string, string>,
) => {
  const trackLabel = `track-${track.meta.index + 1}-${track.meta.trait}-${track.meta.agentAValue}x${track.meta.agentBValue}`;
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
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${root}.zip`);
}

