import { useEffect, useState } from 'react';
import { api, type Health } from './lib/api';
import { ConversationSidebar } from './components/ConversationSidebar';
import { Workspace } from './pages/Workspace';
export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [health, setHealth] = useState<Health | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [draftVersion, setDraftVersion] = useState(0);
  const id = /^#\/discussion\/([a-f0-9-]+)$/.exec(hash)?.[1];
  useEffect(() => {
    void api
      .health()
      .then(setHealth)
      .catch(() => {});
    const change = () => {
      setHash(window.location.hash);
      setSidebarOpen(false);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return (
    <div className={`workspace-shell ${sidebarOpen ? 'sidebar-open' : ''}`}>
      {sidebarOpen && (
        <button
          className="sidebar-shade"
          aria-label="关闭讨论组列表"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <ConversationSidebar
        id={id}
        health={health}
        onNavigate={() => setSidebarOpen(false)}
        onNew={() => {
          setDraftVersion((n) => n + 1);
          setSidebarOpen(false);
        }}
      />
      <Workspace
        key={id ?? `new-${draftVersion}`}
        id={id}
        health={health}
        onMenu={() => setSidebarOpen(!sidebarOpen)}
      />
    </div>
  );
}
