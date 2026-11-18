import { describe, it, expect, vi } from 'vitest';
import { RealModel } from '../server/model.js';
import { summarySchema } from '../server/schemas.js';
const response = (content: string) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 10 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
describe('real model contract', () => {
  it('logs actual provider cache tokens on both failed and successful attempts while preserving retry prefix', async () => {
    const logger = vi.fn();
    let call = 0;
    const fetcher = vi.fn().mockImplementation(async () => {
      call++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: call === 1 ? '{broken' : '{"text":"已核验。"}',
                reasoning_content: 'private reasoning',
              },
            },
          ],
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 10,
            total_tokens: 1010,
            prompt_cache_hit_tokens: call === 1 ? 256 : 900,
            prompt_cache_miss_tokens: call === 1 ? 744 : 100,
            untrusted: 'private usage',
          },
        }),
      );
    });
    const model = new RealModel({
      key: 'private-key',
      baseUrl: 'https://model.test',
      model: 'test',
      fetcher,
      logger,
    });
    await model.run(
      'summary',
      { discussionId: 'safe-id', topic: '测试', messages: [{ text: 'private transcript' }] },
      summarySchema,
    );
    const requests = fetcher.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(requests[0].messages.slice(0, 2)).toEqual(requests[1].messages.slice(0, 2));
    expect(requests[1].messages[2].content).toContain('上次响应未通过');
    expect(logger.mock.calls[0][0]).toMatchObject({
      discussionId: 'safe-id',
      requestLayout: 'prefix',
      error: 'INVALID_OUTPUT',
      cache: { status: 'reported', hitTokens: 256, missTokens: 744 },
    });
    expect(logger.mock.calls[1][0]).toMatchObject({
      usage: { prompt_cache_hit_tokens: 900, prompt_cache_miss_tokens: 100 },
      cache: { hitRate: 0.9 },
    });
    for (const value of ['private-key', 'private transcript', 'private reasoning', 'private usage'])
      expect(JSON.stringify(logger.mock.calls)).not.toContain(value);
  });
  it('retains a legacy transport switch without adding unsupported API cache parameters', async () => {
    const fetcher = vi.fn().mockImplementation(async () => response('{"text":"测试。"}'));
    const model = new RealModel({
      key: 'key',
      baseUrl: 'https://model.test',
      model: 'test',
      requestLayout: 'legacy',
      fetcher,
    });
    const input = { topic: '测试', messages: [], current: { id: 'b' } };
    await model.run('summary', input, summarySchema);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.messages).toHaveLength(2);
    expect(JSON.parse(body.messages[1].content)).toEqual(input);
    expect(body).not.toHaveProperty('cache_control');
    expect(body).not.toHaveProperty('prompt_cache_key');
  });
  it('only forwards the provider thinking toggle when explicitly configured', async () => {
    for (const thinking of [undefined, 'disabled'] as const) {
      const fetcher = vi.fn().mockImplementation(async () => response('{"text":"不虚构结论。"}'));
      const model = new RealModel({
        key: 'test-key',
        baseUrl: 'https://model.test',
        model: 'test',
        thinking,
        fetcher,
      });
      await model.run('summary', {}, summarySchema);
      const body = JSON.parse(fetcher.mock.calls[0][1].body);
      if (thinking) expect(body.thinking).toEqual({ type: 'disabled' });
      else expect(body).not.toHaveProperty('thinking');
    }
  });
  it('reports output truncation metadata without logging content or reasoning', async () => {
    const logger = vi.fn();
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: 'length',
                message: { content: '', reasoning_content: 'private hidden reasoning' },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 4000,
              total_tokens: 4010,
              untrusted: 'sensitive',
            },
          }),
        ),
    );
    const model = new RealModel({
      key: 'secret-key',
      baseUrl: 'https://model.test',
      model: 'test',
      fetcher,
      logger,
    });
    await expect(model.run('insights', {}, summarySchema)).rejects.toThrow('长度上限');
    expect(fetcher).toHaveBeenCalledTimes(2);
    const logs = JSON.stringify(logger.mock.calls);
    expect(logs).toContain('OUTPUT_LIMIT');
    expect(logs).toContain('length');
    expect(logs).not.toContain('private hidden reasoning');
    expect(logs).not.toContain('sensitive');
    expect(logs).not.toContain('secret-key');
  });
  it('retries malformed JSON once and only logs metadata', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response('{broken'))
      .mockResolvedValueOnce(response('{"text":"暂无足够证据形成结论。"}'));
    const log = vi.fn();
    const model = new RealModel({
      key: 'secret-key',
      baseUrl: 'https://model.test/v1',
      model: 'test',
      fetcher,
      logger: log,
    });
    expect((await model.run('summary', {}, summarySchema)).text).toContain('证据');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-key');
    expect(JSON.stringify(log.mock.calls)).not.toContain('暂无');
  });
  it('fails visibly after the one retry and never silently uses a fake model', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const model = new RealModel({
      key: 'key',
      baseUrl: 'https://model.test',
      model: 'test',
      fetcher,
    });
    await expect(model.run('summary', {}, summarySchema)).rejects.toThrow('429');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(model.mode).toBe('real');
  });
  it('does not call network with missing credentials', async () => {
    const fetcher = vi.fn();
    const model = new RealModel({ key: '', baseUrl: 'https://model.test', model: '', fetcher });
    await expect(model.run('summary', {}, summarySchema)).rejects.toThrow('尚未配置');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('recognizes empty outputs and timeouts without exposing response bodies', async () => {
    for (const factory of [
      () => Promise.resolve(response('')),
      () =>
        Promise.reject(
          Object.assign(new Error('sensitive upstream detail'), { name: 'TimeoutError' }),
        ),
    ]) {
      const fetcher = vi.fn(factory);
      const model = new RealModel({
        key: 'key',
        baseUrl: 'https://model.test',
        model: 'test',
        fetcher,
      });
      await expect(model.run('summary', {}, summarySchema)).rejects.not.toThrow('sensitive');
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
});
