import { describe, it, expect } from 'vitest';
import { countSentences, expertSpeechSchema } from '../server/utterance.js';
import { RealModel } from '../server/model.js';
const speech = (text: string) => ({ text, replyTo: null, addressedTo: null });
describe('expert utterance requirements', () => {
  it('accepts one or two sentences and rejects three, including mixed punctuation', () => {
    expect(countSentences('先做试点。')).toBe(1);
    expect(expertSpeechSchema.safeParse(speech('先做试点。保留人工回退。')).success).toBe(true);
    expect(expertSpeechSchema.safeParse(speech('先做试点！是否安全？还需评估。')).success).toBe(
      false,
    );
    expect(
      expertSpeechSchema.safeParse(speech('Pilot first. Keep a fallback. Measure cost.')).success,
    ).toBe(false);
    expect(countSentences('版本 1.5 的预算是 2.5 元；仍需验证。')).toBe(1);
  });
  it('requests a corrected model output once rather than silently cutting a long speech', async () => {
    let calls = 0;
    const model = new RealModel({
      key: 'test',
      baseUrl: 'https://model.test',
      model: 'test',
      fetcher: async () => {
        calls++;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify(
                    speech(
                      calls === 1 ? '第一句。第二句。第三句。' : '先做受控试点。保留人工回退。',
                    ),
                  ),
                },
              },
            ],
          }),
        );
      },
    });
    const result = await model.run('speech', {}, expertSpeechSchema);
    expect(calls).toBe(2);
    expect(result.text).toBe('先做受控试点。保留人工回退。');
  });
});
