import { useEffect, useRef, useState } from 'react';
import { ArrowDown, CornerUpLeft, MessageCircle, LoaderCircle } from 'lucide-react';
import type { Snapshot } from '../../shared/types';
import { phaseLabels } from '../../shared/types';
import { Avatar } from './Primitives';
export function Transcript({
  snapshot,
  focusMessage,
}: {
  snapshot: Snapshot;
  focusMessage: string | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [unread, setUnread] = useState(false);
  const d = snapshot.discussion;
  function latest() {
    following.current = true;
    setUnread(false);
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: 'smooth' });
  }
  useEffect(() => {
    if (following.current) {
      if (box.current) box.current.scrollTop = box.current.scrollHeight;
    } else setUnread(true);
  }, [snapshot.messages.length]);
  useEffect(() => {
    if (!focusMessage) return;
    following.current = false;
    document
      .getElementById(`message-${focusMessage}`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusMessage]);
  const active = snapshot.participants.find((p) => snapshot.activities[p.id]?.state === 'speaking');
  return (
    <section className="panel transcript-panel">
      <div className="panel-heading">
        <h2>
          <span className={`live-dot ${d.status === 'running' ? 'pulsing' : ''}`} />
          现场讨论
        </h2>
        <span className="phase-label">{phaseLabels[d.phase]}</span>
      </div>
      <div
        className="panel-scroll transcript-scroll"
        ref={box}
        onScroll={() => {
          const b = box.current;
          if (b) {
            following.current = b.scrollHeight - b.scrollTop - b.clientHeight < 64;
            if (following.current) setUnread(false);
          }
        }}
      >
        {snapshot.messages.length === 0 ? (
          <div className="waiting-state">
            <MessageCircle size={30} />
            <h3>嘉宾已就位</h3>
            <p>开始讨论后，主持人会先界定问题与评审标准。</p>
          </div>
        ) : (
          snapshot.messages.map((m) => {
            const p = snapshot.participants.find((p) => p.id === m.participantId);
            if (!p) return null;
            const reply = snapshot.messages.find((r) => r.id === m.replyTo);
            const target = snapshot.participants.find((p) => p.id === reply?.participantId);
            return (
              <article
                className={`transcript-message ${p.role === 'moderator' ? 'moderator' : ''} ${focusMessage === m.id ? 'highlighted' : ''}`}
                key={m.id}
                id={`message-${m.id}`}
              >
                <Avatar person={p} small />
                <div className="message-content">
                  <div className="message-meta">
                    <h3>
                      {p.name}
                      {p.role === 'moderator' && <span>（主持人）</span>}
                    </h3>
                    <span className="message-title">
                      {p.occupation} · {p.title}
                    </span>
                    <span className="message-number">#{m.seq}</span>
                  </div>
                  {reply && (
                    <button
                      className="reply-reference"
                      onClick={() => {
                        following.current = false;
                        document
                          .getElementById(`message-${reply.id}`)
                          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                      }}
                    >
                      <CornerUpLeft size={12} />
                      回应 {target?.name} · #{reply.seq}
                    </button>
                  )}
                  <p className="message-text">{m.text}</p>
                </div>
              </article>
            );
          })
        )}
        {active && ['running', 'pausing', 'ending', 'summarizing'].includes(d.status) && (
          <div className="speaking-notice" role="status">
            <LoaderCircle className="spin" size={15} />
            {active.name} 正在{d.status === 'summarizing' ? '整理总结' : '组织发言'}…
          </div>
        )}
        {d.status === 'completed' && (
          <div className="transcript-end">本场讨论已结束 · 查看右侧总结与讨论成果</div>
        )}
      </div>
      {unread && (
        <button className="latest-button" onClick={latest}>
          <ArrowDown size={14} />
          查看最新发言
        </button>
      )}
    </section>
  );
}
