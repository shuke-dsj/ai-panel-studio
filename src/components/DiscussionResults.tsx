import { ChevronRight, CheckCircle2, Zap, FileText } from 'lucide-react';
import type { Insight, Snapshot } from '../../shared/types';
import { isClosedDisagreement } from '../../shared/types';
export function DiscussionResults({
  snapshot,
  onReference,
}: {
  snapshot: Snapshot | null;
  onReference: (id: string) => void;
}) {
  const groups = (kind: Insight['kind']) => snapshot?.insights.filter((i) => i.kind === kind) ?? [];
  return (
    <aside className="results-rail" aria-label="讨论成果">
      <h2>讨论成果</h2>
      <div className="results-scroll">
        <div className="outcomes-list">
          {(['consensus', 'disagreement'] as const).map((kind) => (
            <details open className={`result-section ${kind}`} key={kind}>
              <summary>
                {kind === 'consensus' ? <CheckCircle2 size={19} /> : <Zap size={19} />}
                <strong>
                  {kind === 'consensus' ? '共识' : '分歧'}（{groups(kind).length}）
                </strong>
                <ChevronRight size={17} />
              </summary>
              <div className="result-body">
                {kind === 'disagreement' &&
                  groups(kind).length > 0 &&
                  !snapshot?.discussion.insightLedger && (
                    <p className="empty-result">含保守保留的历史项，请结合来源核对最新立场。</p>
                  )}
                {groups(kind).length ? (
                  groups(kind).map((item) => (
                    <article key={item.id}>
                      {kind === 'disagreement' && /^(?:已关闭|已解决|已消除)/.test(item.text) && (
                        <p className="position">
                          <strong>关闭提议待复核</strong> · 尚未满足关闭凭证要求
                        </p>
                      )}
                      <p>{item.text}</p>
                      {!!item.evidence?.length && (
                        <details className="source-quotes">
                          <summary>查看原文支持与立场</summary>
                          {item.evidence.map((e, n) => (
                            <blockquote key={n}>
                              <button onClick={() => onReference(e.messageId)}>
                                {snapshot?.participants.find((p) => p.id === e.participantId)?.name}{' '}
                                · #{e.seq}
                              </button>
                              ：{e.quote}
                            </blockquote>
                          ))}
                        </details>
                      )}
                      {kind === 'disagreement' &&
                        item.positions.map((p, i) => (
                          <p className="position" key={i}>
                            <strong>
                              {snapshot?.participants.find((w) => w.id === p.participantId)?.name}：
                            </strong>
                            {p.view}
                          </p>
                        ))}
                      <div className="result-references">
                        来源：
                        {item.messageIds.map((id) => {
                          const m = snapshot?.messages.find((m) => m.id === id);
                          return m ? (
                            <button key={id} onClick={() => onReference(id)}>
                              #{m.seq}
                            </button>
                          ) : null;
                        })}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty-result">
                    {kind === 'consensus'
                      ? '至少两位专家明确支持后，将在讨论中更新。'
                      : '尚无已记录的实质分歧。'}
                  </p>
                )}
              </div>
            </details>
          ))}
          {(['question', 'closed', 'unverified'] as const).map((group) => {
            const records =
              snapshot?.discussion.insightLedger?.records.filter(
                (r) =>
                  !r.mergedInto &&
                  (group === 'unverified'
                    ? r.reviewRequired || (!r.verified && r.status === 'consensus')
                    : group === 'question'
                      ? r.status === 'question'
                      : isClosedDisagreement(r)),
              ) ?? [];
            return records.length ? (
              <details className="result-section" key={group}>
                <summary>
                  <FileText size={17} />
                  <strong>
                    {group === 'unverified'
                      ? '证据待复核'
                      : group === 'question'
                        ? '待确认事项'
                        : '已关闭分歧'}
                    （{records.length}）
                  </strong>
                  <ChevronRight size={17} />
                </summary>
                <div className="result-body">
                  {records.map((r) => (
                    <article key={r.id}>
                      <strong>{r.question}</strong>
                      {group === 'unverified' && (
                        <p className="empty-result">
                          以下为未通过复核的候选，不计为当前共识或有效关闭。
                        </p>
                      )}
                      <p>{r.text}</p>
                      <details className="source-quotes">
                        <summary>查看{group !== 'closed' ? '来源' : '关闭依据'}</summary>
                        {r.evidence.map((e, n) => (
                          <blockquote key={n}>
                            <button onClick={() => onReference(e.messageId)}>
                              {snapshot?.participants.find((p) => p.id === e.participantId)?.name} ·
                              #{e.seq}
                            </button>
                            ：{e.quote}
                          </blockquote>
                        ))}
                      </details>
                    </article>
                  ))}
                </div>
              </details>
            ) : null;
          })}
          {!!snapshot?.discussion.previousContexts?.length && (
            <details className="result-section archived-contexts">
              <summary>
                <FileText size={17} />
                <strong>历史前提与成果（{snapshot.discussion.previousContexts.length}）</strong>
                <ChevronRight size={17} />
              </summary>
              <div className="result-body">
                {snapshot.discussion.previousContexts.map((context, index) => (
                  <article key={index}>
                    <strong>
                      历史v{context.version} · {context.topic}
                    </strong>
                    {context.insights.length ? (
                      context.insights.map((item) => (
                        <p key={item.id}>
                          {item.kind === 'consensus' ? '当时的共同判断' : '当时的未决分歧'}：
                          {item.text}
                        </p>
                      ))
                    ) : (
                      <p className="empty-result">
                        替换时尚无已形成成果，原发言仍可在现场记录中查看。
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </details>
          )}
        </div>
        <details open className="result-section closing-summary" data-testid="final-summary">
          <summary>
            <FileText size={19} />
            <strong>主持人总结</strong>
            <ChevronRight size={17} />
          </summary>
          {snapshot?.discussion.summary ? (
            <>
              <p>{snapshot.discussion.summary}</p>
              {snapshot.discussion.summaryDetails && (
                <details className="summary-evidence">
                  <summary>查看完整依据与条件</summary>
                  <p>{snapshot.discussion.summaryDetails}</p>
                </details>
              )}
            </>
          ) : (
            <p className="empty-result">结束时呈现重点结论、未决分歧与下一步。</p>
          )}
          {!!snapshot?.discussion.summaryHistory?.length && (
            <details className="summary-evidence">
              <summary>历史轮次总结（{snapshot.discussion.summaryHistory.length}）</summary>
              {snapshot.discussion.summaryHistory.map((h) => (
                <article key={`${h.cycle}-${h.createdAt}`}>
                  <strong>
                    第{h.cycle}轮 · {h.topic}
                    {h.revisionReason ? ` · ${h.revisionReason}` : ''}
                  </strong>
                  <p>{h.summary}</p>
                  <details>
                    <summary>完整依据</summary>
                    <p>{h.details}</p>
                  </details>
                </article>
              ))}
            </details>
          )}
        </details>
        <p className="results-note">成果来自本场发言，未经外部事实核实。点击来源回看原文。</p>
      </div>
    </aside>
  );
}
