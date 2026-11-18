import type { Snapshot, EndReason } from '../shared/types.js';
import { endReasonLabels, isClosedDisagreement } from '../shared/types.js';
import { extractEvidenceMemory } from './memory.js';
export function renderGroundedSummary(snapshot: Snapshot, highlights: string[]): string {
  snapshot = {
    ...snapshot,
    messages: snapshot.messages.filter((m) => m.seq >= (snapshot.discussion.boundaryStartSeq ?? 0)),
  };
  const name = (id: string) => snapshot.participants.find((p) => p.id === id)?.name ?? '发言人';
  const consensus = snapshot.insights.filter((i) => i.kind === 'consensus');
  const disputes = snapshot.insights.filter((i) => i.kind === 'disagreement');
  const sections = [
    `本场围绕“${snapshot.discussion.effectiveTopic ?? snapshot.discussion.topic}”完成了${snapshot.discussion.turns - (snapshot.discussion.cycleStartTurns ?? 0)}次专家发言。以下结论按本场证据列示，角色意见与阈值均未经外部事实核实。`,
    '有证据的共同判断（不代表全员逐项确认）：\n' +
      (consensus.length
        ? consensus
            .map(
              (i, n) =>
                `${n + 1}. ${i.text}\n明确支持记录：${[...new Set(i.positions.map((p) => p.participantId))].map(name).join('、')}；依据${i.messageIds.map((id) => `#${snapshot.messages.find((m) => m.id === id)?.seq}`).join('、')}。${i.evidence?.map((e) => `\n${name(e.participantId)}（#${e.seq}）：${e.quote}`).join('') ?? ''}`,
            )
            .join('\n')
        : '本场没有满足证据要求的共识。'),
    (snapshot.discussion.insightLedger
      ? '当前实质分歧：\n'
      : '未关闭的分歧记录（包括待复核的历史项）：\n') +
      (disputes.length
        ? disputes
            .map(
              (i, n) =>
                `${n + 1}. ${i.text}\n${i.positions.map((p) => `${name(p.participantId)}：${p.view}`).join('；')}`,
            )
            .join('\n')
        : '本场未记录有证据的未决分歧，不据此推定全员赞同。'),
  ];
  for (const status of ['resolved', 'question'] as const) {
    const records =
      snapshot.discussion.insightLedger?.records.filter(
        (r) =>
          !r.mergedInto &&
          (status === 'question' ? r.status === 'question' : isClosedDisagreement(r)),
      ) ?? [];
    sections.push(
      `${status === 'question' ? '待外部确认事项（不等于专家彼此反对）' : '已关闭分歧及确认原文'}：\n` +
        (records
          .map(
            (r) =>
              `${r.question}：${r.text}\n${r.evidence.map((e) => `${name(e.participantId)}（#${e.seq}）：${e.quote}`).join('\n')}`,
          )
          .join('\n') || '暂无记录。'),
    );
  }
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
export function renderConciseSummary(
  snapshot: Snapshot,
  _highlights: string[],
  reason: EndReason,
): string {
  const d = snapshot.discussion;
  const count = d.turns - (d.cycleStartTurns ?? 0);
  const common = snapshot.insights.filter((i) => i.kind === 'consensus'),
    disputes = snapshot.insights.filter((i) => i.kind === 'disagreement');
  const lines = [
    `${endReasonLabels[reason]}。本轮${count}次专家发言，${common.length}项共同判断、${disputes.length}条未关闭分歧记录。`,
  ];
  for (const [label, items] of [
    ['共同判断（按明确支持者归因）', common],
    [snapshot.discussion.insightLedger ? '实质分歧' : '待复核', disputes],
  ] as const) {
    let used = 0;
    const entries = [];
    for (const item of items) {
      const names = [
        ...new Set(
          item.positions
            .map((p) => snapshot.participants.find((w) => w.id === p.participantId)?.name)
            .filter(Boolean),
        ),
      ].join('、');
      const entry = `${item.text}${item.kind === 'consensus' ? `（${names}支持）` : ''}`;
      if (used + entry.length > 160 || entries.length >= 2) continue;
      entries.push(entry);
      used += entry.length;
    }
    lines.push(
      `${label}：${entries.length ? entries.join('；') : items.length ? '详见展开依据。' : '暂无符合证据要求的记录。'}${items.length > entries.length ? ` 另有${items.length - entries.length}项见展开依据。` : ''}`,
    );
  }
  lines.push(
    `待外部确认${d.insightLedger?.records.filter((r) => r.status === 'question').length ?? 0}项，已关闭${d.insightLedger?.records.filter(isClosedDisagreement).length ?? 0}项（依据见展开）。`,
    '下一步：先确认未决条件、验证口径与负责人，再据实际证据决定是否推进。全部原话、条件和历史修正保存在展开依据中；以上不是外部核实结果。',
  );
  return lines.join('\n\n');
}
