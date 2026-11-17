import { describe, it, expect, vi } from 'vitest';
import { RealModel } from '../server/model.js';
import { summarySchema } from '../server/schemas.js';
const response = (content: string) =>
  new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 10 } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
describe('real model contract', () => {
  it('reports output truncation metadata without logging content or reasoning', async () => {
    const logger = vi.fn();
    const fetcher = vi
      .fn()
      .mockImplementation(
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
