import { describe, expect, it } from 'vitest';
import { isClosedDisagreement } from '../shared/types.js';
import { Store } from '../server/db.js';
import { seedReviewedExamples } from '../server/examples.js';
import { seedCurated } from '../server/seed.js';

describe('reviewed real discussion archives', () => {
  it('imports five distinct completed topics offline and preserves their evidence on repeat', () => {
    const store = new Store(':memory:');
    try {
      seedCurated(store);
      seedReviewedExamples(store);
      const snapshots = store
        .list()
        .filter((discussion) => discussion.source === 'real-example')
        .map(({ id }) => store.snapshot(id));
      expect(store.list()).toHaveLength(10);
      expect(snapshots).toHaveLength(5);
      expect(new Set(snapshots.map(({ discussion }) => discussion.topic)).size).toBe(5);
      expect(
        snapshots.flatMap(({ discussion }) =>
          discussion.insightLedger!.records.filter(isClosedDisagreement),
        ),
      ).toHaveLength(1);
      for (const { discussion, participants, messages, insights, cursor } of snapshots) {
        expect(discussion.status).toBe('completed');
        expect(discussion.summary).toBeTruthy();
        expect(participants.filter(({ role }) => role === 'moderator')).toHaveLength(1);
        expect(participants.filter(({ role }) => role === 'expert')).toHaveLength(
          discussion.expertCount,
        );
        expect(cursor).toBe(0);
        const byId = new Map(messages.map((message) => [message.id, message]));
        for (const { replyTo } of messages) if (replyTo) expect(byId.has(replyTo)).toBe(true);
        for (const insight of insights) {
          const sources = insight.evidence!.map((evidence) => {
            expect(byId.get(evidence.messageId)?.text).toContain(evidence.quote);
            expect(byId.get(evidence.messageId)?.participantId).toBe(evidence.participantId);
            return evidence.participantId;
          });
          if (insight.kind === 'consensus') expect(new Set(sources).size).toBeGreaterThanOrEqual(2);
        }
      }
      seedReviewedExamples(store);
      expect(store.list()).toHaveLength(10);
      expect(snapshots.map(({ discussion }) => store.snapshot(discussion.id))).toEqual(snapshots);
    } finally {
      store.close();
    }
  });
});
