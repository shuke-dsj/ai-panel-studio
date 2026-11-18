import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/db.js';
import { createApp } from '../server/app.js';
import { DemoModel } from '../server/demo-model.js';
describe('on-disk and HTTP recovery', () => {
  it('reopens SQLite and resumes an interrupted summary checkpoint', () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-test-'));
    const path = join(dir, 'recovery.sqlite');
    try {
      const before = new Store(path);
      const d = before.create('重启恢复测试', 2, 6);
      const ledger = {
        version: 1 as const,
        records: [
          {
            id: 'closed-fixture',
            question: '已关闭测试条件',
            text: '双方确认后关闭',
            status: 'resolved' as const,
            verified: true,
            requiredParticipantIds: ['a', 'b'],
            evidence: [],
            aliases: ['old-fixture'],
            lastSeq: 2,
            closedAtSeq: 2,
            history: [],
          },
        ],
        audit: [],
      };
      before.replaceInsights(d.id, [], '带墓碑的恢复测试', before.checkpoint(d.id), ledger);
      before.update(d.id, { status: 'summarizing', resumeStatus: 'summarizing' });
      const cursor = before.cursor(d.id);
      before.close();
      const after = new Store(path);
      after.recover();
      expect(after.get(d.id).status).toBe('paused');
      expect(after.get(d.id).insightLedger).toEqual(ledger);
      expect(after.insights(d.id)).toEqual([]);
      expect(after.get(d.id).resumeStatus).toBe('summarizing');
      expect(after.cursor(d.id)).toBeGreaterThan(cursor);
      expect(after.events(d.id, 0)[0].discussionId).toBe(d.id);
      after.close();
    } finally {
      for (const name of ['recovery.sqlite', 'recovery.sqlite-wal', 'recovery.sqlite-shm'])
        rmSync(join(dir, name), { force: true });
      rmdirSync(dir);
    }
  });
  it('serves replayable SSE with valid IDs and cleans up disconnected subscribers', async () => {
    const store = new Store(':memory:');
    const { app } = await createApp(store, new DemoModel(0));
    const d = store.create('SSE重放', 2, 6);
    store.update(d.id, { status: 'generating' });
    store.update(d.id, { status: 'draft' });
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    try {
      const result = await fetch(`${address}/api/discussions/${d.id}/events?after=1`, {
        headers: { 'Last-Event-ID': '1' },
      });
      expect(result.headers.get('content-type')).toContain('text/event-stream');
      const reader = result.body!.getReader();
      const chunk = await reader.read();
      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain('id: 2');
      expect(text).not.toContain('id: 1\n');
      expect(text).toContain('event: update');
      await reader.cancel();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(store.bus.listenerCount(d.id)).toBe(0);
    } finally {
      await app.close();
      store.close();
    }
  });
});
