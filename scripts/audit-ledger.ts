import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { settings } from '../server/config.js';
import type { Snapshot, InsightEvidence, Discussion } from '../shared/types.js';
const oldId = 'e950f15d-2229-456a-bf2d-cf3a2194ba06';
const newId = process.argv[2];
if (!newId) throw new Error('请提供本次真实回归讨论ID');
const before = JSON.parse(
  readFileSync('docs/evidence/ledger-repair-before.json', 'utf8').replace(/^\uFEFF/, ''),
) as Snapshot;
const db = new DatabaseSync(settings.database, { readOnly: true });
try {
  const results = [];
  for (const id of [oldId, newId]) {
    const s = (await (
      await fetch(`http://127.0.0.1:${settings.port}/api/discussions/${id}`)
    ).json()) as Snapshot;
    const saved = JSON.parse(
      (db.prepare('SELECT data FROM discussions WHERE id=?').get(id) as { data: string }).data,
    ) as Discussion;
    const rows = (table: string) =>
      (
        db
          .prepare(
            `SELECT data FROM ${table} WHERE discussion_id=? ORDER BY ${table === 'insights' ? 'rowid' : 'seq'}`,
          )
          .all(id) as { data: string }[]
      ).map((r) => JSON.parse(r.data));
    const ledger = s.discussion.insightLedger!;
    const live = ledger.records.filter((r) => !r.mergedInto);
    const closed = live.filter(
      (r) =>
        r.verified &&
        r.closedAtSeq !== undefined &&
        !['question', 'disagreement'].includes(r.status),
    );
    const commons = s.insights.filter((i) => i.kind === 'consensus');
    const exact = (e: InsightEvidence) =>
      s.messages.some(
        (m) =>
          m.id === e.messageId &&
          m.participantId === e.participantId &&
          m.seq === e.seq &&
          m.text.includes(e.quote),
      ) && s.participants.some((p) => p.id === e.participantId && p.role === 'expert');
    const checks = {
      completed: s.discussion.status === 'completed',
      sqliteDiscussion: isDeepStrictEqual(saved, s.discussion),
      sqliteMessages: isDeepStrictEqual(rows('messages'), s.messages),
      sqliteInsights: isDeepStrictEqual(rows('insights'), s.insights),
      onlyOneCompletion: rows('events').filter((e) => e.type === 'completed').length === 1,
      originalMessagesPreserved:
        id !== oldId ||
        isDeepStrictEqual(
          before.messages.map((m) => ({ ...m, createdAt: new Date(m.createdAt).toISOString() })),
          s.messages.map((m) => ({ ...m, createdAt: new Date(m.createdAt).toISOString() })),
        ),
      oldSummaryArchived:
        id !== oldId ||
        s.discussion.summaryHistory?.some((h) => h.summary === before.discussion.summary) === true,
      noUnreviewedDisputes: live.every((r) => r.status !== 'disagreement' || r.verified),
      noMergedPublished: s.insights.every(
        (i) => !ledger.records.find((r) => r.id === i.id)?.mergedInto,
      ),
      noClosedPublishedAsDispute: closed.every(
        (r) => !s.insights.some((i) => i.id === r.id && i.kind === 'disagreement'),
      ),
      actualClosures: closed.length > 0,
      actualConsensus: commons.length > 0,
      consensusQuotes: commons.every(
        (i) =>
          new Set(
            i.evidence
              ?.filter(
                (e) => exact(e) && e.supportsClaim && ['support', 'accept'].includes(e.stance),
              )
              .map((e) => e.participantId),
          ).size >= 2,
      ),
      closureWitnesses: closed.every((r) =>
        r.requiredParticipantIds.every((p) =>
          r.evidence.some(
            (e) =>
              e.participantId === p &&
              exact(e) &&
              ((e.supportsClaim && ['support', 'accept'].includes(e.stance)) ||
                e.stance === 'withdraw'),
          ),
        ),
      ),
      literalAllPublished: s.insights.every((i) => i.evidence?.every(exact)),
    };
    results.push({
      id,
      checks,
      passed: Object.values(checks).every(Boolean),
      counts: {
        consensus: commons.length,
        disagreements: s.insights.filter((i) => i.kind === 'disagreement').length,
        questions: live.filter((r) => r.status === 'question').length,
        closed: closed.length,
        merged: ledger.records.filter((r) => r.mergedInto).length,
      },
      canonical: live.map((r) => ({
        id: r.id,
        status: r.status,
        question: r.question,
        text: r.text,
        evidence: r.evidence,
      })),
      archives: {
        summaryVersions: s.discussion.summaryHistory?.length ?? 0,
        previousContexts: s.discussion.previousContexts?.length ?? 0,
      },
    });
  }
  writeFileSync(
    'docs/evidence/ledger-archive-audit.json',
    JSON.stringify({ testedAt: new Date().toISOString(), results }, null, 2),
  );
  console.info(
    JSON.stringify(
      results.map(({ id, checks, passed, counts }) => ({ id, checks, passed, counts })),
      null,
      2,
    ),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
} finally {
  db.close();
}
