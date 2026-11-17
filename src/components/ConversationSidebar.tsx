import { useEffect, useState } from 'react';
import { Layers2, Plus, MessageCircle, Search, CircleAlert } from 'lucide-react';
import { api, type Health } from '../lib/api';
import { statusLabels, type Discussion } from '../../shared/types';
export function ConversationSidebar({
  id,
  health,
  onNavigate,
  onNew,
}: {
  id?: string;
  health: Health | null;
  onNavigate: () => void;
  onNew: () => void;
}) {
  const [items, setItems] = useState<Discussion[]>([]),
    [error, setError] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState('all');
  useEffect(() => {
    let alive = true,
      busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      try {
        const rows = await api.list();
        if (alive) {
          setItems(rows);
          setError('');
        }
      } catch {
        if (alive) setError('列表暂时无法更新');
      } finally {
        busy = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    window.addEventListener('focus', refresh);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, [id]);
  const filtered = items.filter(
    (d) =>
      [d.topic, d.effectiveTopic, d.focus]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === 'all' ||
        (filter === 'active' && !['completed', 'paused', 'error'].includes(d.status)) ||
        (filter === 'paused' && ['paused', 'error'].includes(d.status)) ||
        (filter === 'completed' && d.status === 'completed')),
  );
  return (
    <aside className="conversation-sidebar" aria-label="讨论组列表">
      <a href="#/" className="workspace-brand" onClick={onNavigate}>
        <Layers2 size={25} />
        <span>Panel Studio</span>
      </a>
      <a className="button primary new-group" href="#/" onClick={onNew}>
        <Plus size={18} />
        新建讨论组
      </a>
      <label className="sidebar-search">
        <Search size={15} />
        <input
          aria-label="搜索讨论"
          placeholder="搜索讨论组"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <select
        className="sidebar-filter"
        aria-label="讨论状态筛选"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      >
        <option value="all">所有讨论</option>
        <option value="active">进行中</option>
        <option value="paused">已暂停</option>
        <option value="completed">已结束</option>
      </select>
      {error && (
        <p className="sidebar-error" role="status">
          <CircleAlert size={14} />
          {error}
        </p>
      )}
      <nav className="conversation-list" aria-label="主题会话">
        {filtered.map((d) => (
          <a
            key={d.id}
            href={`#/discussion/${d.id}`}
            onClick={onNavigate}
            className={`conversation-row ${id === d.id ? 'selected' : ''}`}
            aria-current={id === d.id ? 'page' : undefined}
          >
            <MessageCircle size={19} />
            <div>
              <strong title={d.effectiveTopic ?? d.topic}>{d.effectiveTopic ?? d.topic}</strong>
              <span>
                <i className={`status-dot status-${d.status}`} />
                {statusLabels[d.status]} · {d.turns - (d.cycleStartTurns ?? 0)}次发言
              </span>
              <small>
                {d.source === 'curated'
                  ? '人工示例'
                  : d.source === 'test'
                    ? '确定性演示'
                    : '真实模型'}{' '}
                ·{' '}
                {new Date(d.updatedAt).toLocaleDateString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                })}
              </small>
            </div>
          </a>
        ))}
        {!filtered.length && (
          <p className="sidebar-empty">
            {items.length ? '没有匹配的讨论' : '从一个值得讨论的问题开始'}
          </p>
        )}
      </nav>
      <div className="sidebar-footer">
        <span className="status-dot" />
        {health?.mode === 'demo'
          ? '演示模式 · 确定性数据'
          : health?.configured
            ? '真实模型已配置'
            : '模型尚未配置'}
        <small>虚构专家 · 内容请独立判断</small>
      </div>
    </aside>
  );
}
