import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/db.js';
import { createApp } from '../server/app.js';
import { DemoModel } from '../server/demo-model.js';
import { RealModel } from '../server/model.js';
describe('on-disk and HTTP recovery', () => {
  it('saves usage from a rejected model response and its retry and replays the cumulative values', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'panel-usage-'));
    const path = join(dir, 'usage.sqlite');
    const store = new Store(path);
    let calls = 0;
    const model = new RealModel({
      key: 'fixture',
      model: 'fixture',
      baseUrl: 'https://fixture.invalid',
      fetcher: async () => {
        calls++;
        const participants = ['moderator', 'expert', 'expert'].map((role, i) => ({
          role,
          name: '嘉宾' + i,
          occupation: '研究',
          title: '评审',
          stance: '核对',
          focus: '范围',
        }));
        return Response.json({
          choices: [
            { message: { content: calls === 1 ? '{invalid' : JSON.stringify({ participants }) } },
          ],
          usage:
            calls === 1
              ? {
                  prompt_tokens: 200,
                  completion_tokens: 30,
                  prompt_cache_hit_tokens: 0,
                  prompt_cache_miss_tokens: 200,
                }
              : {
                  prompt_tokens: 300,
                  completion_tokens: 50,
                  prompt_tokens_details: { cached_tokens: 180 },
                },
        });
      },
    });
    const { app } = await createApp(store, model);
    const d = store.create('缓存统计测试', 2, 6);
    const other = store.create('独立讨论', 2, 6);
    try {
      const result = await app.inject({
        method: 'POST',
        url: `/api/discussions/${d.id}/roster`,
        payload: {},
      });
      expect(result.statusCode).toBe(200);
      const totals = {
        attempts: 2,
        inputTokens: 500,
        outputTokens: 80,
        cacheHitTokens: 180,
        cacheMissTokens: 320,
        inputReports: 2,
        outputReports: 2,
        cacheReports: 2,
      };
      expect(result.json().discussion.tokenUsage).toEqual(totals);
      expect(store.get(other.id).tokenUsage).toBeUndefined();
      const events = store.events(d.id, 0).filter((e) => e.type === 'usage');
      expect(events).toHaveLength(2);
      expect(events[0].data).toMatchObject({ attempts: 1, inputTokens: 200, cacheHitTokens: 0 });
      expect(events[1].data).toEqual(totals);
      const reopened = new Store(path);
      try {
        expect(reopened.snapshot(d.id).discussion.tokenUsage).toEqual(totals);
        expect(reopened.events(d.id, events[0].seq).find((e) => e.type === 'usage')?.data).toEqual(
          totals,
        );
      } finally {
        reopened.close();
      }
    } finally {
      await app.close();
      store.close();
      for (const name of ['usage.sqlite', 'usage.sqlite-wal', 'usage.sqlite-shm'])
        rmSync(join(dir, name), { force: true });
      rmdirSync(dir);
    }
  });
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
