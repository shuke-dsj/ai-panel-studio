import { X } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Snapshot } from '../../shared/types';
import { activityLabels } from './RoundTable';
export function GuestInspectors({
  snapshot,
  ids,
  onClose,
  onReference,
}: {
  snapshot: Snapshot;
  ids: string[];
  onClose: (id: string) => void;
  onReference: (id: string) => void;
}) {
  return (
    <div className="inspector-dock" aria-label="独立嘉宾窗口">
      {ids.map((id) => {
        const person = snapshot.participants.find((p) => p.id === id);
        if (!person) return null;
        const activity = snapshot.activities[id] ?? { state: 'idle' as const, focus: person.focus },
          messages = snapshot.messages.filter((m) => m.participantId === id);
        return (
          <section
            key={id}
            className="guest-inspector"
            aria-label={`${person.name}的独立窗口`}
            style={{ '--guest': person.color } as CSSProperties}
          >
            <header>
              <div>
                <h2>
                  {person.name} · {person.occupation}
                </h2>
                <span>
                  {person.title} ·{' '}
                  <b className={`inspector-state ${activity.state}`}>
                    {activityLabels[activity.state]}
                  </b>
                </span>
              </div>
              <button
                className="icon-button"
                aria-label={`关闭${person.name}窗口`}
                onClick={() => onClose(id)}
              >
                <X size={17} />
              </button>
            </header>
            <div className="inspector-scroll">
              <p className="inspector-stance">
                <strong>立场</strong>
                {person.stance}
              </p>
              <p className="public-focus">
                <strong>当前关注点</strong>
                {activity.focus || person.focus}
              </p>
              <h3>
                历史发言 <span>（{messages.length}条）</span>
              </h3>
              {messages.length ? (
                messages.map((m) => (
                  <article key={m.id}>
                    <button onClick={() => onReference(m.id)}>#{m.seq}</button>
                    <p>{m.text}</p>
                  </article>
                ))
              ) : (
                <p className="muted">尚未正式发言。</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
