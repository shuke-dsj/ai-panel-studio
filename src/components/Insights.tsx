import { CheckCircle2, AlertCircle, FileText, ChevronRight } from 'lucide-react';
import type { Insight, Snapshot } from '../../shared/types';
export function Insights({
  snapshot,
  onReference,
}: {
  snapshot: Snapshot;
  onReference: (id: string) => void;
}) {
  function items(kind: Insight['kind']) {
    const values = snapshot.insights.filter((i) => i.kind === kind);
    return values.length ? (
      values.map((item, index) => (
        <article className="insight-item" key={item.id}>
          <div className="insight-text">
            <span className="insight-number">{index + 1}</span>
            <p>{item.text}</p>
          </div>
          {kind === 'disagreement' &&
            item.positions.map((position, i) => (
              <p className="position" key={`${position.participantId}-${i}`}>
                <strong>
                  {snapshot.participants.find((p) => p.id === position.participantId)?.name}：
                </strong>
                {position.view}
              </p>
            ))}
          <div className="evidence-links">
            <span>发言依据</span>
            {item.messageIds.map((id) => {
              const m = snapshot.messages.find((m) => m.id === id);
              return m ? (
                <button
                  key={id}
                  onClick={() => onReference(id)}
                  aria-label={`查看第 ${m.seq} 条发言`}
                >
                  #{m.seq}
                  <ChevronRight size={10} />
                </button>
              ) : null;
            })}
          </div>
        </article>
      ))
    ) : (
      <p className="insight-empty">
        {kind === 'consensus'
          ? '等待至少两位专家形成有依据的共同判断。'
          : '尚未记录实质分歧，讨论推进后会持续更新。'}
      </p>
    );
  }
  return (
    <section className="panel insights-panel">
      <div className="panel-heading">
        <h2>讨论成果</h2>
        <span>持续更新</span>
      </div>
      <div className="panel-scroll insights-scroll">
        <section className="insight-group consensus">
          <h3>
            <CheckCircle2 size={18} />
            共识<span>{snapshot.insights.filter((i) => i.kind === 'consensus').length}</span>
          </h3>
          {items('consensus')}
        </section>
        <section className="insight-group disagreement">
          <h3>
            <AlertCircle size={18} />
            分歧<span>{snapshot.insights.filter((i) => i.kind === 'disagreement').length}</span>
          </h3>
          {items('disagreement')}
        </section>
        {snapshot.discussion.summary && (
          <section className="summary-group" data-testid="final-summary">
            <h3>
              <FileText size={18} />
              主持人总结
            </h3>
            <p>{snapshot.discussion.summary}</p>
            {snapshot.discussion.summaryDetails && (
              <details>
                <summary>展开完整依据、条件与阶段安排</summary>
                <p>{snapshot.discussion.summaryDetails}</p>
              </details>
            )}
          </section>
        )}
        <p className="evidence-note">成果来自本场发言，未经过外部事实核验。点击编号回看原文。</p>
      </div>
    </section>
  );
}
