import type { Snapshot } from '../shared/types.js';
import { extractEvidenceMemory } from './memory.js';
export function renderGroundedSummary(snapshot: Snapshot, highlights: string[]): string {
  const name = (id: string) => snapshot.participants.find((p) => p.id === id)?.name ?? '发言人';
  const consensus = snapshot.insights.filter((i) => i.kind === 'consensus');
  const disputes = snapshot.insights.filter((i) => i.kind === 'disagreement');
  const sections = [
    `本场围绕“${snapshot.discussion.topic}”完成了${snapshot.discussion.turns}次专家发言。以下结论按本场证据列示，角色意见与阈值均未经外部事实核实。`,
    '有证据的共同判断（不代表全员逐项确认）：\n' +
      (consensus.length
        ? consensus
            .map(
              (i, n) =>
                `${n + 1}. ${i.text}\n明确支持记录：${[...new Set(i.positions.map((p) => p.participantId))].map(name).join('、')}；依据${i.messageIds.map((id) => `#${snapshot.messages.find((m) => m.id === id)?.seq}`).join('、')}。`,
            )
            .join('\n')
        : '本场没有满足证据要求的共识。'),
    '仍未解决的分歧：\n' +
      (disputes.length
        ? disputes
            .map(
              (i, n) =>
                `${n + 1}. ${i.text}\n${i.positions.map((p) => `${name(p.participantId)}：${p.view}`).join('；')}`,
            )
            .join('\n')
        : '本场未记录有证据的未决分歧，不据此推定全员赞同。'),
  ];
  const memory = extractEvidenceMemory(snapshot.messages);
  sections.push(
    '关键条件与阶段安排（保留原话，可能是提议、否决或后续修正，不自动视为共识）：\n' +
      (memory.anchors.length
        ? memory.anchors.map((a) => `${name(a.participantId)}（#${a.seq}）：${a.quote}`).join('\n')
        : '本场未抽取到带条件或时间范围的陈述。'),
  );
  const selected = [...new Set(highlights)].flatMap((id) => {
    const m = snapshot.messages.find((m) => m.id === id);
    const p = snapshot.participants.find((p) => p.id === m?.participantId);
    return m && p?.role === 'expert' ? [`${p.name}提出（#${m.seq}，待验证）：${m.text}`] : [];
  });
  sections.push(
    '后续验证参考：\n' +
      (selected.length
        ? selected.join('\n')
        : '先由相关方确认尚未解决的范围、阶段和验收条件，再决定是否推进。'),
  );
  return sections.join('\n\n');
}
