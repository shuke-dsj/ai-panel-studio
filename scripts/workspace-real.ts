import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { settings } from '../server/config.js';
import type { Discussion, Snapshot } from '../shared/types.js';
const base = `http://127.0.0.1:${settings.port}/api`;
const output = process.env.WORKSPACE_REPORT_PATH ?? 'docs/evidence/workspace-real-latest.json';
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(base + path, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(180000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}
let id: string | undefined;
try {
  const health = await api<{ mode: string; configured: boolean }>('/health');
  if (health.mode !== 'real' || !health.configured)
    throw new Error('必须为已配置真实模式；不回退演示。');
  id = process.argv[2] === '--resume' ? process.argv[3] : undefined;
  if (!id) {
    const d = await api<Discussion>('/discussions', {
      topic:
        process.env.WORKSPACE_TOPIC ??
        '6位工程师、无专职运维的小团队如何评审只读内部知识库？固定前提：仅非敏感文档，不接入敏感库；初始试点2周，后续4周收益评估需另行批准。请比较业务价值、安全、维护与退出条件，保留实质分歧，逐步明确可验证的决策。',
      expertCount: Number(process.env.WORKSPACE_EXPERTS ?? 4),
      maxTurns: 16,
      maxModelCalls: 140,
      maxActiveMinutes: 12,
    });
    id = d.id;
    console.info(`真实工作区回归：${id}，${d.expertCount}位专家，上限16次/140调用/12分钟。`);
    await api(`/discussions/${id}/roster`, {});
    await api(`/discussions/${id}/confirm`, {});
    await api(`/discussions/${id}/start`, {});
  } else {
    const s = await api<Snapshot>(`/discussions/${id}`);
    if (s.discussion.source !== 'live' || s.discussion.maxTurns !== 16)
      throw new Error('恢复记录配置不匹配');
    if (['paused', 'error', 'ready'].includes(s.discussion.status))
      await api(`/discussions/${id}/resume`, {});
  }
  const deadline = Date.now() + 14 * 60000;
  let s: Snapshot,
    previous = '';
  let steered = false;
  while (true) {
    s = await api<Snapshot>(`/discussions/${id}`);
    steered ||= !!s.discussion.directionVersion;
    const progress = `${s.discussion.status}/${s.discussion.turns}/v${s.discussion.directionVersion ?? 0}`;
    if (previous !== progress) {
      console.info(progress);
      previous = progress;
    }
    if (s.discussion.status === 'completed') break;
    if (['paused', 'error'].includes(s.discussion.status))
      throw new Error(s.discussion.error ?? '讨论暂停');
    if (!steered && s.discussion.status === 'running' && s.discussion.turns >= 1) {
      const body = {
        text: '接下来优先讨论失败后的人工回退、退出责任人与维护工时验证；2周、只读和非敏感的硬前提不变，不把新阈值当成已批准。',
        mode: 'focus',
        clientRequestId: randomUUID(),
      };
      await api(`/discussions/${id}/directions`, body);
      await api(`/discussions/${id}/directions`, body);
      steered = true;
      console.info('已在进行中调整焦点，并重复请求核验幂等。');
    }
    if (Date.now() > deadline) {
      await api(`/discussions/${id}/pause`, {});
      throw new Error('超出回归等待窗口，已请求暂停。');
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const reread = await api<Snapshot>(`/discussions/${id}`);
  const direction = s.messages.find((m) => m.kind === 'direction');
  const expertIds = new Set(s.participants.filter((p) => p.role === 'expert').map((p) => p.id));
  const expertMessages = s.messages.filter((m) => expertIds.has(m.participantId));
  const db = new DatabaseSync(resolve(settings.database), { readOnly: true });
  let saved: Discussion, messageIds: string[], events: { type: string; seq: number }[];
  try {
    saved = JSON.parse(
      (db.prepare('SELECT data FROM discussions WHERE id=?').get(id) as { data: string }).data,
    );
    messageIds = (
      db.prepare('SELECT id FROM messages WHERE discussion_id=? ORDER BY seq').all(id) as {
        id: string;
      }[]
    ).map((row) => row.id);
    events = (
      db.prepare('SELECT data FROM events WHERE discussion_id=? ORDER BY seq').all(id) as {
        data: string;
      }[]
    ).map((row) => JSON.parse(row.data));
  } finally {
    db.close();
  }
  const checks = {
    real: s.discussion.source === 'live',
    completed: s.discussion.status === 'completed',
    moreThanSix: s.discussion.turns > 6,
    bounded: s.discussion.turns <= 16 && (s.discussion.modelCalls ?? 0) <= 140,
    allExpertsContributed: new Set(expertMessages.map((m) => m.participantId)).size === s.discussion.expertCount,
    oneUserDirection:
      s.messages.filter((m) => m.kind === 'direction').length === 1 &&
      s.discussion.directionVersion === 1,
    directionAcknowledged: s.discussion.handledDirectionVersion === 1,
    noStalePostDirection:
      !!direction &&
      s.messages.filter((m) => m.seq > direction.seq).every((m) => m.directionVersion === 1),
    subsequentExpertResponses:
      !!direction && expertMessages.filter((m) => m.seq > direction.seq).length >= 4,
    validReferences: s.messages.every(
      (m) => !m.replyTo || s.messages.some((p) => p.id === m.replyTo && p.seq < m.seq),
    ),
    outcomesPresent: s.insights.length > 0,
    shortSummary: !!s.discussion.summary && s.discussion.summary.length < 900,
    detailedEvidence:
      !!s.discussion.summaryDetails &&
      (s.discussion.evidenceMemory?.anchors ?? []).every((a) =>
        s.discussion.summaryDetails!.includes(a.quote),
      ),
    stableReload: JSON.stringify(s) === JSON.stringify(reread),
    sqliteArchiveMatches:
      JSON.stringify(saved) === JSON.stringify(s.discussion) &&
      JSON.stringify(messageIds) === JSON.stringify(s.messages.map((m) => m.id)),
    oneCompletionEvent: events.filter((e) => e.type === 'completed').length === 1,
    liveOutcomesBeforeEnd: events.some(
      (e) => e.type === 'insights' && e.seq < events.find((e) => e.type === 'completed')!.seq,
    ),
    truthfulBoundary:
      !!s.discussion.endReason &&
      (!['turn_limit', 'model_budget', 'time_limit'].includes(s.discussion.endReason) ||
        !s.discussion.summary?.includes('已达成一致')),
  };
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    output,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        id,
        checks,
        passed: Object.values(checks).every(Boolean),
        snapshot: s,
        modelRuntime: {
          thinking: settings.thinking ?? 'provider-default',
          maxOutputTokens: settings.maxTokens,
          contextBudgetChars: settings.contextBudget,
        },
        semanticReview: '待逐条审阅；结构核对不能替代语义判断。',
      },
      null,
      2,
    ),
  );
  console.info(
    JSON.stringify({
      id,
      checks,
      endReason: s.discussion.endReason,
      turns: s.discussion.turns,
      modelCalls: s.discussion.modelCalls,
      output,
    }),
  );
  if (Object.values(checks).some((v) => !v)) process.exitCode = 1;
} catch (error) {
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    output,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        id,
        status: 'incomplete',
        reason: error instanceof Error ? error.message : '未知错误',
      },
      null,
      2,
    ),
  );
  console.error(error instanceof Error ? error.message : '回归未完成');
  process.exitCode = 1;
}
