import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { Store } from '../server/db.js';
import { Engine } from '../server/engine.js';
import { configuredModel, settings } from '../server/config.js';
import { countSentences } from '../server/utterance.js';
import { hasUniversalAgreement } from '../server/consistency.js';
import type { InsightEvidence } from '../shared/types.js';

const path = 'docs/evidence/cache-discussion.json';
const database = 'data/cache-quality.sqlite';
const resume = process.argv[2] === '--resume' ? process.argv[3] : undefined;
const attempts: Record<string, any>[] = [];
if (resume && existsSync(path)) {
  const prior = JSON.parse(readFileSync(path, 'utf8'));
  if (prior.id === resume) attempts.push(...prior.attempts);
}
const model = configuredModel(true, {
  logger: (entry) => {
    attempts.push(entry as Record<string, any>);
    if (attempts.length % 10 === 0)
      console.info(JSON.stringify({ attempts: attempts.length, lastTask: (entry as any).task }));
  },
});
if (!model.configured) throw new Error('真实模型未配置，不使用演示替代。');
const store = new Store(database),
  engine = new Engine(store, model, settings.contextBudget);
let id = resume;
try {
  if (!id) {
    const d = store.create(
      '公开合成短讨论：6位工程师、无专职运维的小团队，计划做仅非敏感示例文档的只读知识库2周试点，后续4周收益评估需另行批准。只评审运行联系人与退出负责人的指定时点，区分联系名单、能力验收、启动和退出阶段；真实人选由用户指定，不代替用户批准。',
      2,
      6,
      'live',
      { maxModelCalls: 90, maxActiveMs: 8 * 60000 },
    );
    id = d.id;
    await engine.generate(id);
    engine.confirm(id);
  }
  const before = store.snapshot(id);
  engine.start(id);
  await engine.wait(id);
  const s = store.snapshot(id),
    expertIds = new Set(s.participants.filter((p) => p.role === 'expert').map((p) => p.id));
  const expertMessages = s.messages.filter((m) => expertIds.has(m.participantId));
  const literal = (e: InsightEvidence) =>
    expertIds.has(e.participantId) &&
    s.messages.some(
      (m) =>
        m.id === e.messageId &&
        m.seq === e.seq &&
        m.participantId === e.participantId &&
        m.text.includes(e.quote),
    );
  const measured = attempts.filter((a) => a.cache?.status === 'reported');
  const hit = measured.reduce((n, a) => n + a.cache.hitTokens, 0),
    miss = measured.reduce((n, a) => n + a.cache.missTokens, 0);
  const checks = {
    real: model.mode === 'real' && s.discussion.source === 'live',
    prefixTransport: attempts.every((a) => a.requestLayout === 'prefix'),
    completed: s.discussion.status === 'completed',
    bounded: s.discussion.turns <= 6 && (s.discussion.modelCalls ?? 0) <= 90,
    completeShortDiscussion: expertMessages.length === 6,
    bothExpertsParticipated: new Set(expertMessages.map((m) => m.participantId)).size === 2,
    shortSpeeches: expertMessages.every(
      (m) => countSentences(m.text) >= 1 && countSentences(m.text) <= 2,
    ),
    validReplyIds: s.messages.every(
      (m) => !m.replyTo || s.messages.some((prior) => prior.id === m.replyTo && prior.seq < m.seq),
    ),
    consensusWitnesses: s.insights
      .filter((i) => i.kind === 'consensus')
      .every(
        (i) =>
          new Set(
            i.evidence
              ?.filter(
                (e) => literal(e) && e.supportsClaim && ['support', 'accept'].includes(e.stance),
              )
              .map((e) => e.participantId),
          ).size >= 2,
      ),
    literalOutcomeSources: s.insights.every((i) => i.evidence?.every(literal)),
    honestSummary:
      !!s.discussion.summary &&
      !!s.discussion.summaryDetails &&
      !hasUniversalAgreement(s.discussion.summary),
    originalPrefixPreserved: isDeepStrictEqual(
      s.messages.slice(0, before.messages.length),
      before.messages,
    ),
    exactlyOneCompletion: store.events(id, 0).filter((e) => e.type === 'completed').length === 1,
    usageReported: measured.length === attempts.length && measured.length > 0,
  };
  store.close();
  const reopened = new Store(database);
  try {
    Object.assign(checks, { sqliteSnapshotMatches: isDeepStrictEqual(reopened.snapshot(id), s) });
  } finally {
    reopened.close();
  }
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        id,
        database,
        checks,
        passed: Object.values(checks).every(Boolean),
        usage: {
          attempts: attempts.length,
          measuredAttempts: measured.length,
          hitTokens: hit,
          missTokens: miss,
          hitRate: hit + miss ? hit / (hit + miss) : null,
        },
        attempts,
        snapshot: s,
        semanticReview: '待逐条核对；短讨论按6次安全上限结束，不要求强行达成一致。',
      },
      null,
      2,
    ),
  );
  console.info(
    JSON.stringify({
      id,
      checks,
      usage: { hitTokens: hit, missTokens: miss, hitRate: hit + miss ? hit / (hit + miss) : null },
      output: path,
    }),
  );
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
} catch (error) {
  mkdirSync('docs/evidence', { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        id,
        attempts,
        status: 'incomplete',
        error: error instanceof Error ? error.message : '回归失败',
        snapshot: id ? store.snapshot(id) : null,
      },
      null,
      2,
    ),
  );
  console.error(error instanceof Error ? error.message : '回归失败');
  process.exitCode = 1;
  store.close();
}
