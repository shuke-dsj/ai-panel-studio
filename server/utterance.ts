import { speechSchema } from './schemas.js';
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'sentence' });
export function countSentences(text: string): number {
  return [...segmenter.segment(text)].filter((part) => /[\p{L}\p{N}]/u.test(part.segment)).length;
}
export const expertSpeechSchema = speechSchema.refine((value) => {
  const count = countSentences(value.text);
  return count >= 1 && count <= 2;
}, '专家每次正式发言必须为 1–2 句，请重写完整发言，不要遗漏必要观点');
