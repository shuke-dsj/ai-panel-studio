import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configuredModel, settings } from '../server/config.js';
import { countSentences } from '../server/utterance.js';
import type { Discussion, PanelEvent, Snapshot } from '../shared/types.js';
import { hasUniversalAgreement } from '../server/consistency.js';
import { extractEvidenceMemory } from '../server/memory.js';

const base = `http://127.0.0.1:${settings.port}`;
const output = process.env.REAL_REPORT_PATH ?? 'docs/evidence/real-smoke-latest.json';
let discussionId: string | null = null;
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}/api${path}`, {
    ...(body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
    signal: AbortSignal.timeout(180000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `本地 API HTTP ${response.status}`);
  return data as T;
}
function save(report: unknown) {
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
}
try {
  if (!configuredModel(true).configured)
    throw new Error('真实模型配置尚未填全；未创建测试讨论，也未调用模型。');
  const health = await api<{ mode: string; configured: boolean }>('/health');
  if (health.mode !== 'real' || !health.configured)
    throw new Error('当前服务尚未切换为已配置的真实模式；未发起测试。');
  const resumeId = process.argv[2] === '--resume' ? process.argv[3] : undefined;
  if (resumeId && !/^[a-f0-9-]{36}$/.test(resumeId)) throw new Error('无效的恢复讨论 ID。');
  let d: Discussion;
  if (resumeId) {
    d = (await api<Snapshot>(`/discussions/${resumeId}`)).discussion;
    if (d.source !== 'live' || d.expertCount !== 4 || d.maxTurns !== 6)
      throw new Error('只能恢复当前真实短讨论，不能混用演示或其他配置。');
    discussionId = d.id;
    console.info(`恢复原真实短讨论：${d.id}，已保存 ${d.turns} 次专家发言`);
    if (['paused', 'error', 'ready'].includes(d.status))
      await api(`/discussions/${d.id}/resume`, {});
    else if (!['running', 'pausing', 'ending', 'summarizing', 'completed'].includes(d.status))
      throw new Error('该讨论尚未完成阵容确认，不能直接恢复。');
  } else {
    d = await api<Discussion>('/discussions', {
      topic:
        '6位工程师、无专职运维的小团队是否应试点内部知识库RAG？固定前提：只读、仅非敏感文档，不接入敏感库；初始试点为2周。第3至第6周的4周收益评估是需另行批准的后续阶段，不代表试点已延长。请讨论业务价值、权限风险、维护成本，保留否决条件与未决分歧。',
      expertCount: 4,
      maxTurns: 6,
    });
    discussionId = d.id;
    console.info(`真实短讨论已创建：${d.id}（4 位专家，最多 6 次专家发言）`);
    await api(`/discussions/${d.id}/roster`, {});
    await api(`/discussions/${d.id}/confirm`, {});
    await api(`/discussions/${d.id}/start`, {});
  }
  const deadline = Date.now() + 15 * 60000;
  let snapshot: Snapshot;
  let last = '';
  while (true) {
    snapshot = await api<Snapshot>(`/discussions/${d.id}`);
    const current = `${snapshot.discussion.status}/${snapshot.discussion.phase}/${snapshot.discussion.turns}`;
    if (current !== last) {
      console.info(`进度：${current}`);
      last = current;
    }
    if (snapshot.discussion.status === 'completed') break;
    if (['error', 'paused'].includes(snapshot.discussion.status))
      throw new Error(snapshot.discussion.error ?? '讨论已暂停，请检查现场后重试。');
    if (Date.now() > deadline) {
      await api(`/discussions/${d.id}/pause`, {});
      throw new Error('测试超过 15 分钟，已请求在当前步骤结束后暂停，避免继续调用。');
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  const experts = new Set(
    snapshot.participants.filter((p) => p.role === 'expert').map((p) => p.id),
  );
  const expertMessages = snapshot.messages.filter((m) => experts.has(m.participantId));
  const messages = new Map(snapshot.messages.map((m) => [m.id, m]));
  const db = new DatabaseSync(resolve(settings.database), { readOnly: true });
  let persisted: Discussion;
  let persistedMessageIds: string[];
  let events: PanelEvent[];
  try {
    persisted = JSON.parse(
      (db.prepare('SELECT data FROM discussions WHERE id=?').get(d.id) as { data: string }).data,
    );
    persistedMessageIds = (
      db.prepare('SELECT id FROM messages WHERE discussion_id=? ORDER BY seq').all(d.id) as {
        id: string;
      }[]
    ).map((m) => m.id);
    events = (
      db.prepare('SELECT data FROM events WHERE discussion_id=? ORDER BY seq').all(d.id) as {
        data: string;
      }[]
    ).map((e) => JSON.parse(e.data));
  } finally {
    db.close();
  }
  const completed = events.find((e) => e.type === 'completed');
  const checks = {
    realSource: snapshot.discussion.source === 'live',
    participantCount: snapshot.participants.length === 5,
    turnLimit: expertMessages.length > 0 && expertMessages.length <= 6,
    oneOrTwoSentences: expertMessages.every(
      (m) => countSentences(m.text) >= 1 && countSentences(m.text) <= 2,
    ),
    validReplyReferences: snapshot.messages.every(
      (m) => !m.replyTo || (!!messages.get(m.replyTo) && messages.get(m.replyTo)!.seq < m.seq),
    ),
    hasCrossSpeakerReply: expertMessages.some(
      (m) => m.replyTo && messages.get(m.replyTo)?.participantId !== m.participantId,
    ),
    insightReferences: snapshot.insights.every(
      (i) => i.messageIds.length > 0 && i.messageIds.every((id) => messages.has(id)),
    ),
    consensusHasTwoExperts: snapshot.insights
      .filter((i) => i.kind === 'consensus')
      .every(
        (i) =>
          new Set(
            i.messageIds
              .map((id) => messages.get(id)!.participantId)
              .filter((id) => experts.has(id)),
          ).size >= 2,
      ),
    insightsUpdatedBeforeCompletion:
      !!completed && events.some((e) => e.type === 'insights' && e.seq < completed.seq),
    contextSummarySaved: !!persisted.contextSummary.trim(),
    naturalLanguageSummary: !!persisted.summary?.trim() && !/^\s*[\[{]/.test(persisted.summary),
    databaseMatchesSnapshot:
      persisted.status === 'completed' &&
      persisted.summary === snapshot.discussion.summary &&
      JSON.stringify(persistedMessageIds) === JSON.stringify(snapshot.messages.map((m) => m.id)),
    oneCompletion: events.filter((e) => e.type === 'completed').length === 1,
    noUnattributedUniversalAgreement: !hasUniversalAgreement(persisted.summary ?? ''),
    evidenceMemorySaved:
      JSON.stringify(persisted.evidenceMemory) ===
      JSON.stringify(extractEvidenceMemory(snapshot.messages)),
    allDisputesInSummary: snapshot.insights
      .filter((i) => i.kind === 'disagreement')
      .every((i) => persisted.summary?.includes(i.text)),
    allConditionsInSummary: extractEvidenceMemory(snapshot.messages).anchors.every((a) =>
      persisted.summary?.includes(a.quote),
    ),
  };
  const report = {
    testedAt: new Date().toISOString(),
    discussionId: d.id,
    url: `http://127.0.0.1:5173/#/discussion/${d.id}`,
    mode: 'real',
    checks,
    counts: {
      expertTurns: expertMessages.length,
      distinctSpeakers: new Set(expertMessages.map((m) => m.participantId)).size,
      consensus: snapshot.insights.filter((i) => i.kind === 'consensus').length,
      disagreements: snapshot.insights.filter((i) => i.kind === 'disagreement').length,
      insightUpdates: events.filter((e) => e.type === 'insights').length,
    },
    semanticReview:
      '待人工逐条检查上下文承接、观点变化、遗漏反对及摘要保真度；结构通过不代表语义正确，未形成共识或分歧也不自动判错。',
    participants: snapshot.participants,
    messages: snapshot.messages,
    insights: snapshot.insights,
    summary: persisted.summary,
    contextSummary: persisted.contextSummary,
  };
  save(report);
  console.info(
    JSON.stringify({ discussionId: d.id, checks, counts: report.counts, report: output }),
  );
  if (Object.values(checks).some((v) => !v)) process.exitCode = 1;
} catch (error) {
  const reason = error instanceof Error ? error.message : '真实验证未完成。';
  save({ testedAt: new Date().toISOString(), discussionId, status: 'incomplete', reason });
  console.error(reason);
  process.exitCode = 1;
}
