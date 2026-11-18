import { createHash } from 'node:crypto';
import type {
  Insight,
  InsightEvidence,
  InsightLedger,
  IssueRecord,
  Message,
  Participant,
  Snapshot,
} from '../shared/types.js';
import type { LedgerDecision } from './schemas.js';
import { hasUniversalAgreement } from './consistency.js';

const normalized = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/[\p{P}\p{Z}\s]/gu, '')
    .toLowerCase();
const unique = <T>(values: T[]) => [...new Set(values)];
const positive = (e: InsightEvidence) =>
  (e.stance === 'support' || e.stance === 'accept') && e.supportsClaim;
const fingerprint = (text: string) =>
  createHash('sha256').update(normalized(text)).digest('hex').slice(0, 16);
const allEvidence = (r: IssueRecord) => [...r.history.flatMap((h) => h.evidence), ...r.evidence];

export function ledgerFor(snapshot: Snapshot): InsightLedger {
  if (snapshot.discussion.insightLedger) return structuredClone(snapshot.discussion.insightLedger);
  return {
    version: 1,
    audit: [],
    records: snapshot.insights.map((item) => {
      const evidence: InsightEvidence[] =
        item.evidence ??
        item.messageIds.flatMap((id) => {
          const m = snapshot.messages.find((m) => m.id === id);
          return m
            ? [
                {
                  messageId: id,
                  participantId: m.participantId,
                  seq: m.seq,
                  quote: m.text,
                  stance: 'context' as const,
                  supportsClaim: false,
                  view: item.positions.find((p) => p.participantId === m.participantId)?.view ?? '',
                },
              ]
            : [];
        });
      return {
        id: item.id,
        question: item.question ?? item.text,
        text: item.text,
        status: item.kind,
        verified: false,
        requiredParticipantIds: unique(item.positions.map((p) => p.participantId)),
        evidence,
        aliases: [],
        lastSeq: Math.max(0, ...evidence.map((e) => e.seq)),
        history: [
          {
            status: item.kind,
            text: item.text,
            evidence,
            seq: Math.max(0, ...evidence.map((e) => e.seq)),
          },
        ],
      };
    }),
  };
}

export function ledgerDigest(ledger: InsightLedger) {
  return ledger.records.map((r) => ({
    id: r.id,
    question: r.question,
    text: r.text,
    status: r.status,
    verified: r.verified,
    aliases: r.aliases,
    mergedInto: r.mergedInto,
    requiredParticipantIds: r.requiredParticipantIds,
    lastSeq: r.lastSeq,
    closedAtSeq: r.closedAtSeq,
    minSeqByParticipant: Object.fromEntries(
      r.requiredParticipantIds.map((person) => [
        person,
        Math.max(
          0,
          ...allEvidence(r)
            .filter((e) => e.participantId === person && e.stance !== 'context')
            .map((e) => e.seq),
        ),
      ]),
    ),
    evidence: r.mergedInto ? [] : r.evidence.filter((e) => e.stance !== 'context'),
    contextMessageIds: unique(
      r.evidence.filter((e) => e.stance === 'context').map((e) => e.messageId),
    ),
    previousPositions: r.requiredParticipantIds.flatMap((person) =>
      allEvidence(r)
        .filter(
          (e) =>
            e.participantId === person &&
            e.stance !== 'context' &&
            !r.evidence.some(
              (current) => current.messageId === e.messageId && current.quote === e.quote,
            ),
        )
        .sort((a, b) => b.seq - a.seq)
        .slice(0, 1),
    ),
  }));
}

export function projectInsights(ledger: InsightLedger): Insight[] {
  return ledger.records
    .filter((r) => r.status === 'disagreement' || (r.status === 'consensus' && r.verified))
    .map((r) => {
      const evidence = r.status === 'consensus' ? r.evidence.filter(positive) : r.evidence;
      return {
        id: r.id,
        kind: r.status as Insight['kind'],
        question: r.question,
        text: r.text,
        messageIds: unique(evidence.map((e) => e.messageId)),
        positions: evidence.map((e) => ({ participantId: e.participantId, view: e.view })),
        evidence,
      };
    });
}

/** All decisions are semantic proposals. This verifier owns IDs, provenance,
 * party coverage, chronology, tombstones and the published projection. */
export function applyLedger(
  ledger: InsightLedger,
  decisions: LedgerDecision[],
  messages: Message[],
  participants: Participant[],
  scope = '',
) {
  const result = structuredClone(ledger);
  const byId = new Map(result.records.map((r) => [r.id, r]));
  const seq = Math.max(0, ...messages.map((m) => m.seq));
  const experts = new Set(participants.filter((p) => p.role === 'expert').map((p) => p.id));
  const audit: InsightLedger['audit'][number] = {
    seq,
    accepted: [],
    closed: [],
    reopened: [],
    merged: [],
    rejected: [],
  };
  const resolve = (id: string): IssueRecord | undefined => {
    const seen = new Set<string>();
    let record = byId.get(id) ?? result.records.find((r) => r.aliases.includes(id));
    while (record?.mergedInto && !seen.has(record.id)) {
      seen.add(record.id);
      record = byId.get(record.mergedInto);
    }
    return record;
  };
  for (const decision of decisions) {
    const reject = (reason: string) => audit.rejected.push({ issueId: decision.issueId, reason });
    if (hasUniversalAgreement(decision.text)) {
      reject('unsupported_unanimity');
      continue;
    }
    let current = decision.issueId
      ? resolve(decision.issueId)
      : (result.records.find(
          (r) =>
            !r.mergedInto &&
            (normalized(r.question) === normalized(decision.question) ||
              normalized(r.text) === normalized(decision.text) ||
              r.history.some((h) => normalized(h.text) === normalized(decision.text))),
        ) ?? resolve(`issue-${fingerprint(`${scope}:${decision.question}`)}`));
    if (decision.issueId && !current) {
      reject('unknown_issue_id');
      continue;
    }
    const merge = unique(decision.mergeIds).map(resolve);
    if (merge.some((r) => !r)) {
      reject('unknown_merge_id');
      continue;
    }
    const related = unique([current, ...merge].filter((r): r is IssueRecord => !!r));
    const evidence: InsightEvidence[] = decision.evidence.flatMap((entry) => {
      const message = messages.find((m) => m.id === entry.messageId);
      if (
        !message ||
        !experts.has(message.participantId) ||
        entry.quote.length < 4 ||
        !message.text.includes(entry.quote)
      )
        return [];
      if (
        (entry.stance === 'support' || entry.stance === 'accept') &&
        /^我?(?:不同意|不接受|不支持|仍反对)/.test(entry.quote) &&
        !/但|不过|然而/.test(entry.quote)
      )
        return [];
      if (entry.stance === 'withdraw' && /不撤回|仍反对|不再支持/.test(entry.quote)) return [];
      return [{ ...entry, participantId: message.participantId, seq: message.seq }];
    });
    if (!evidence.length || evidence.length !== decision.evidence.length) {
      reject('invalid_literal_evidence');
      continue;
    }
    const supporters = new Set(evidence.filter(positive).map((e) => e.participantId));
    const required = unique(related.flatMap((r) => r.requiredParticipantIds));
    const opposition = evidence.some((e) => e.stance === 'oppose');
    const legacyQuestion =
      decision.status === 'question' &&
      related.some((r) => r.status === 'disagreement' && !r.verified) &&
      !related.some((r) => r.status === 'disagreement' && r.verified);
    const validConfirmers = new Set(
      evidence
        .filter(
          (e) =>
            (positive(e) ||
              e.stance === 'withdraw' ||
              (legacyQuestion && e.stance === 'context')) &&
            e.seq >=
              Math.max(
                0,
                ...related.flatMap((r) =>
                  allEvidence(r)
                    .filter(
                      (old) => old.participantId === e.participantId && old.stance !== 'context',
                    )
                    .map((old) => old.seq),
                ),
              ),
        )
        .map((e) => e.participantId),
    );
    const closesOpen = related.some((r) => r.status === 'disagreement');
    if (
      decision.status === 'disagreement' &&
      related.some((r) => r.status === 'consensus') &&
      !evidence.some(
        (e) =>
          e.stance === 'oppose' &&
          e.seq >
            Math.max(...related.filter((r) => r.status === 'consensus').map((r) => r.lastSeq)),
      )
    ) {
      reject('consensus_requires_new_opposition');
      continue;
    }
    if (
      decision.status === 'disagreement' &&
      (!opposition ||
        new Set(evidence.filter((e) => e.stance !== 'context').map((e) => e.participantId)).size <
          2)
    ) {
      reject('use_question_for_unconfirmed_proposal');
      continue;
    }
    if (decision.status === 'consensus' && (supporters.size < 2 || opposition)) {
      reject('insufficient_common_support');
      continue;
    }
    if (
      (decision.status === 'resolved' ||
        (['consensus', 'question'].includes(decision.status) &&
          related.some((r) => r.status === 'disagreement'))) &&
      (!decision.complete ||
        validConfirmers.size < 2 ||
        opposition ||
        required.some((p) => !validConfirmers.has(p)))
    ) {
      reject('closure_missing_current_party_confirmation');
      continue;
    }
    if (decision.status === 'resolved' && !current) {
      reject('cannot_close_unknown_issue');
      continue;
    }
    const closed = related.filter(
      (r) => r.closedAtSeq !== undefined && r.status !== 'disagreement',
    );
    const reopening = ['disagreement', 'question'].includes(decision.status) && closed.length > 0;
    if (
      reopening &&
      !evidence.some(
        (e) => e.stance === 'oppose' && e.seq > Math.max(...closed.map((r) => r.closedAtSeq!)),
      )
    ) {
      reject('closed_issue_requires_new_opposition');
      continue;
    }
    if (
      decision.status === 'disagreement' &&
      /^(?:已关闭|已解决|已消除)[:：\s]/.test(decision.text)
    ) {
      reject('closed_label_is_not_open_state');
      continue;
    }
    if (decision.status === 'consensus' && closed.length && !decision.complete) {
      reject('closed_issue_partial_restatement');
      continue;
    }
    if (!current) {
      const id = `issue-${fingerprint(`${scope}:${decision.question}`)}`;
      current = byId.get(id);
      if (!current) {
        current = {
          id,
          question: decision.question,
          text: decision.text,
          status: decision.status,
          verified: false,
          requiredParticipantIds: [],
          evidence: [],
          aliases: [],
          lastSeq: 0,
          history: [],
        };
        byId.set(id, current);
        result.records.push(current);
      }
    }
    // Repeating an identical reviewed operation does not grow its history.
    const changed =
      current.status !== decision.status ||
      current.text !== decision.text ||
      JSON.stringify(current.evidence) !== JSON.stringify(evidence);
    if (changed && current.history.length === 0 && current.evidence.length)
      current.history.push({
        status: current.status,
        text: current.text,
        evidence: current.evidence,
        seq: current.lastSeq,
      });
    const wasOpen = closesOpen || current.status === 'disagreement';
    for (const source of related) {
      if (source.id === current.id) continue;
      current.aliases = unique([...current.aliases, source.id, ...source.aliases]);
      current.history.push(...source.history);
      source.status = 'merged';
      source.mergedInto = current.id;
      audit.merged.push(source.id);
    }
    current.question = decision.question;
    current.text = decision.text;
    current.status = decision.status;
    current.verified = true;
    current.requiredParticipantIds = unique([
      ...required,
      ...evidence.filter((e) => e.stance !== 'context').map((e) => e.participantId),
    ]);
    current.evidence = evidence;
    current.lastSeq = Math.max(...evidence.map((e) => e.seq));
    if (wasOpen && (decision.status === 'resolved' || decision.status === 'consensus')) {
      current.closedAtSeq = seq;
      audit.closed.push(current.id);
    }
    if (reopening) {
      delete current.closedAtSeq;
      audit.reopened.push(current.id);
    }
    if (changed)
      current.history.push({ status: current.status, text: current.text, evidence, seq });
    audit.accepted.push(current.id);
  }
  result.audit.push(audit);
  return { ledger: result, insights: projectInsights(result), audit };
}
