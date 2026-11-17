import { useEffect, useState } from 'react';
import { ArrowRight, Plus, Search, X, Users, MessageSquare, LoaderCircle } from 'lucide-react';
import type { Discussion } from '../../shared/types';
import { api } from '../lib/api';
import { EmptyState, ErrorBanner, StatusLabel } from '../components/Primitives';

export function Home({
  openCreate,
  onCloseCreate,
}: {
  openCreate: boolean;
  onCloseCreate: () => void;
}) {
  const [items, setItems] = useState<Discussion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [topic, setTopic] = useState('');
  const [experts, setExperts] = useState(4);
  const [turns, setTurns] = useState(12);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const value = await api.list();
        if (active) {
          setItems(value);
          setError('');
        }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '讨论列表读取失败。');
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    window.addEventListener('focus', refresh);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    if (!openCreate) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) onCloseCreate();
      if (e.key === 'Tab') {
        const elements = [
          ...document.querySelectorAll<HTMLElement>(
            '[role="dialog"] button:not(:disabled),[role="dialog"] textarea,[role="dialog"] select',
          ),
        ];
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openCreate, creating, onCloseCreate]);
  const filtered = items.filter(
    (d) =>
      (!query || d.topic.toLowerCase().includes(query.toLowerCase())) &&
      (filter === 'all' ||
        (filter === 'completed' && d.status === 'completed') ||
        (filter === 'paused' && ['paused', 'error'].includes(d.status)) ||
        (filter === 'active' && !['completed', 'paused', 'error'].includes(d.status))),
  );
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || creating) return;
    setCreating(true);
    setError('');
    try {
      const d = await api.create({ topic: topic.trim(), expertCount: experts, maxTurns: turns });
      onCloseCreate();
      window.location.hash = `/discussion/${d.id}`;
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建失败');
    } finally {
      setCreating(false);
    }
  }
  return (
    <main className="home-scroll">
      <section className="home-content">
        <div className="home-heading">
          <div>
            <h1>让不同观点，坐到同一张桌前。</h1>
            <p>发起一场 AI 圆桌，在观点碰撞中找到更清晰的判断。</p>
          </div>
          <button
            className="button primary"
            onClick={() => window.dispatchEvent(new Event('panel:create'))}
          >
            <Plus size={17} />
            发起新讨论
          </button>
        </div>
        <section className="discussion-library">
          <div className="library-title">
            <h2>
              所有讨论 <span>{items.length}</span>
            </h2>
            <label className="search">
              <Search size={16} />
              <input
                aria-label="搜索讨论"
                placeholder="搜索话题"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className="filter-tabs" role="group" aria-label="讨论状态筛选">
            {[
              ['all', '全部'],
              ['active', '进行中'],
              ['paused', '已暂停'],
              ['completed', '已结束'],
            ].map(([key, label]) => (
              <button
                key={key}
                className={filter === key ? 'active' : ''}
                onClick={() => setFilter(key)}
                aria-pressed={filter === key}
              >
                {label}
              </button>
            ))}
          </div>
          {error && !openCreate && <ErrorBanner>{error}</ErrorBanner>}
          {loading ? (
            <div className="loading">
              <LoaderCircle className="spin" />
              正在读取讨论…
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState title="这里还没有讨论">换一个筛选条件，或发起一个你关心的话题。</EmptyState>
          ) : (
            <div className="discussion-list">
              {filtered.map((d) => (
                <a className="discussion-row" href={`#/discussion/${d.id}`} key={d.id}>
                  <span className="discussion-row-icon">
                    <MessageSquare size={22} />
                  </span>
                  <div className="discussion-row-main">
                    <h3>{d.topic}</h3>
                    <div className="row-meta">
                      <span>
                        <Users size={13} />
                        {d.expertCount} 位专家
                      </span>
                      <span>
                        {d.turns} / {d.maxTurns} 次发言
                      </span>
                      <span>
                        {d.source === 'curated'
                          ? '人工编写示例'
                          : d.source === 'test'
                            ? '确定性演示'
                            : d.source === 'real-example'
                              ? '模型生成示例'
                              : '自主圆桌'}
                      </span>
                    </div>
                  </div>
                  <div className="row-trailing">
                    <StatusLabel status={d.status} />
                    <time dateTime={d.updatedAt}>
                      {new Intl.DateTimeFormat('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        timeZone: 'Asia/Shanghai',
                      }).format(new Date(d.updatedAt))}
                    </time>
                  </div>
                  <ArrowRight size={18} className="row-arrow" />
                </a>
              ))}
            </div>
          )}
        </section>
        <div className="home-note">
          一个议题，多种视角。专家角色均为虚构，讨论内容需要独立判断。
        </div>
      </section>
      {openCreate && (
        <div className="modal-backdrop">
          <section
            className="create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-title"
          >
            <div className="dialog-heading">
              <h2 id="create-title">发起一场圆桌讨论</h2>
              <button
                className="icon-button"
                aria-label="关闭"
                disabled={creating}
                onClick={onCloseCreate}
              >
                <X size={20} />
              </button>
            </div>
            <p className="muted">提出一个值得讨论的问题，我们会为你组建多视角的专家阵容。</p>
            <form onSubmit={create}>
              <label className="field">
                讨论话题
                <textarea
                  autoFocus
                  required
                  maxLength={2000}
                  rows={4}
                  placeholder="例如：企业知识库是否应优先引入 RAG？"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                />
                <span className="field-hint">{topic.length} / 2000</span>
              </label>
              <div className="form-pair">
                <label className="field">
                  专家人数
                  <select value={experts} onChange={(e) => setExperts(Number(e.target.value))}>
                    {[2, 3, 4, 5, 6].map((n) => (
                      <option key={n} value={n}>
                        {n} 位专家{n === 4 ? '（默认）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  专家发言上限
                  <select value={turns} onChange={(e) => setTurns(Number(e.target.value))}>
                    {Array.from({ length: 15 }, (_, i) => i + 6).map((n) => (
                      <option value={n} key={n}>
                        {n} 次{n === 12 ? '（默认）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="field-help">另配一位主持人。先预览并确认阵容，再开始讨论。</p>
              {error && <ErrorBanner>{error}</ErrorBanner>}
              <div className="dialog-actions">
                <button
                  type="button"
                  className="button"
                  disabled={creating}
                  onClick={onCloseCreate}
                >
                  取消
                </button>
                <button className="button primary" disabled={creating || !topic.trim()}>
                  {creating ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                  生成嘉宾阵容
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
