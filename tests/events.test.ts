import { describe, it, expect } from 'vitest';
import { applyEvent } from '../src/lib/usePanel.js';
import { Store } from '../server/db.js';
describe('client event recovery', () => {
  it('clears stale activity when a new direction version arrives and unlocks a regenerated roster', () => {
    const store = new Store(':memory:');
    try {
      const d = store.create('方向版本测试', 2, 48), s = store.snapshot(d.id);
      s.activities = { old: { state: 'speaking', focus: '过期关注点' } };
      s.discussion.rosterStale = true;
      const updated = applyEvent(s, { discussionId: d.id, seq: 1, type: 'status', data: { ...s.discussion, directionVersion: 1 }, createdAt: '' });
      expect(updated.activities).toEqual({});
      const roster = applyEvent(updated, { discussionId: d.id, seq: 2, type: 'roster', data: [], createdAt: '' });
      expect(roster.discussion.rosterStale).toBe(false);
    } finally { store.close(); }
  });
  it('deduplicates replayed events and ignores foreign or old cursor data', () => {
    const store = new Store(':memory:');
    const d = store.create('test', 2, 6);
    const s = store.snapshot(d.id);
    store.update(d.id, { status: 'generating' });
    const e = store.events(d.id, 0)[0];
    const updated = applyEvent(s, e);
    expect(updated.discussion.status).toBe('generating');
    expect(applyEvent(updated, e)).toBe(updated);
    expect(applyEvent(updated, { ...e, seq: e.seq + 1, discussionId: 'foreign' })).toBe(updated);
    store.close();
  });
});
