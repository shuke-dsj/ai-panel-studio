import type { EvidenceMemory, Message } from '../shared/types.js';
const sentences = new Intl.Segmenter('zh-CN', { granularity: 'sentence' });
export function extractEvidenceMemory(messages: Message[]): EvidenceMemory {
  const anchors: EvidenceMemory['anchors'] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    let index = 0;
    for (const part of sentences.segment(message.text)) {
      const quote = part.segment.trim();
      const kinds: EvidenceMemory['anchors'][number]['kinds'] = [];
      if (/范围|非敏感|敏感|只读|接入|授权|权限|边界|scope|sensitive|read.only/i.test(quote))
        kinds.push('scope');
      if (
        /(?:\d+|[一二两三四五六七八九十]+)\s*(?:天|周|个月|月)|阶段|截止|后续|\b\d+\s*(?:days?|weeks?|months?)\b/i.test(
          quote,
        )
      )
        kinds.push('timeline');
      if (
        /如果|若|除非|前提|否则|必须|不得|禁止|不能|不可|不应|不允许|不批准|不支持|不超过|未通过|反对|撤回|低于|高于|至少|至多|仅|阈值|否决|退出|基线|审计|验收|预算|人时|先.{0,20}再|完成.{0,20}后|\d+\s*%|\b(?:must|unless|only|veto|budget|audit|not|never|without|before|after|if|threshold)\b/i.test(
          quote,
        )
      )
        kinds.push('condition');
      const key = `${message.participantId}:${quote}`;
      if (kinds.length && !seen.has(key)) {
        seen.add(key);
        anchors.push({
          id: `${message.id}:${index}`,
          messageId: message.id,
          participantId: message.participantId,
          seq: message.seq,
          quote,
          kinds,
        });
      }
      index++;
    }
  }
  return { version: 1, anchors };
}
