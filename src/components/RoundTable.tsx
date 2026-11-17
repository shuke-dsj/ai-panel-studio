import type { CSSProperties } from 'react';
import { phaseLabels, type Snapshot, type Participant } from '../../shared/types';
export const activityLabels = { idle: '待机', preparing: '准备发言', speaking: '发言中' };
const palette = ['#b78626', '#227a64', '#427abf', '#8c58ac', '#ba5e68', '#59818c', '#806347'];
export function RoundTable({
  snapshot,
  count,
  onSelect,
  selected,
}: {
  snapshot: Snapshot | null;
  count: number;
  onSelect: (id: string) => void;
  selected: string[];
}) {
  const actual = snapshot?.participants ?? [];
  const people: Participant[] = actual.length
    ? actual
    : Array.from({ length: count + 1 }, (_, i) => ({
        id: `preview-${i}`,
        discussionId: '',
        role: i ? 'expert' : 'moderator',
        name: i ? `专家 ${i}` : '主持人',
        occupation: '等待话题生成',
        title: '',
        stance: '',
        focus: '',
        color: palette[i],
      }));
  const host = people.find((p) => p.role === 'moderator'),
    experts = people.filter((p) => p.role === 'expert');
  function node(person: Participant, index = -1) {
    const theta =
      ((experts.length === 2 ? 90 + index * 180 : 45 + (index * 270) / (experts.length - 1)) *
        Math.PI) /
      180;
    const x = index < 0 ? 50 : 50 - 25 * Math.sin(theta),
      y = index < 0 ? 8 : 51 - 32 * Math.cos(theta);
    const state = snapshot?.activities[person.id]?.state ?? 'idle';
    return (
      <button
        key={person.id}
        type="button"
        data-testid="guest-node"
        data-role={person.role}
        data-state={state}
        data-side={index < 0 ? 'host' : x < 50 ? 'left' : 'right'}
        aria-label={`${person.name} · ${person.occupation} · ${activityLabels[state]}`}
        aria-pressed={selected.includes(person.id)}
        disabled={!actual.length}
        onClick={() => onSelect(person.id)}
        className={`guest-node ${state} ${index < 0 ? 'host-node' : ''} ${!actual.length ? 'preview-node' : ''}`}
        style={{ '--guest': person.color, left: `${x}%`, top: `${y}%` } as CSSProperties}
      >
        <span className="guest-avatar">
          {actual.length ? person.name.slice(0, 1) : index < 0 ? '主' : index + 1}
        </span>
        <span className="guest-label">
          <strong>
            {person.name}
            <small>{index < 0 ? '主持人' : `专家 ${index + 1}`}</small>
          </strong>
          <span className="guest-occupation">{person.occupation}</span>
          {person.title && <span className="guest-title">{person.title}</span>}
          {person.stance && (
            <span className="guest-stance" title={person.stance}>
              立场：{person.stance}
            </span>
          )}
          <span className="guest-state">
            <i />
            {actual.length ? activityLabels[state] : '待生成'}
          </span>
        </span>
      </button>
    );
  }
  return (
    <div className="roundtable-stage" aria-label={`${experts.length}位专家与1位主持人的圆桌`}>
      <div className="table-center">
        <strong>圆桌讨论</strong>
        <span>{snapshot ? phaseLabels[snapshot.discussion.phase] : '让观点互相影响'}</span>
      </div>
      {host && node(host)}
      {experts.map((p, i) => node(p, i))}
    </div>
  );
}
