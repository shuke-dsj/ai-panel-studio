import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api, type Health } from './lib/api';
import { usePanel } from './lib/usePanel';
import { BrandHeader, ErrorBanner, Footer } from './components/Primitives';
import { Home } from './pages/Home';
import { Roster } from './pages/Roster';
import { Studio } from './pages/Studio';
function DiscussionPage({ id }: { id: string }) {
  const panel = usePanel(id);
  if (!panel.snapshot)
    return (
      <main className="loading-page">
        {panel.error ? (
          <ErrorBanner>{panel.error}</ErrorBanner>
        ) : (
          <>
            <LoaderCircle className="spin" />
            正在进入演播厅…
          </>
        )}
        <a href="#/">返回所有讨论</a>
      </main>
    );
  return ['draft', 'generating', 'roster_ready'].includes(panel.snapshot.discussion.status) ? (
    <Roster {...panel} snapshot={panel.snapshot} />
  ) : (
    <Studio {...panel} snapshot={panel.snapshot} />
  );
}
export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [health, setHealth] = useState<Health | null>(null);
  const [create, setCreate] = useState(false);
  const match = /^#\/discussion\/([a-f0-9-]+)$/.exec(hash);
  const id = match?.[1];
  useEffect(() => {
    api
      .health()
      .then(setHealth)
      .catch(() => {});
    const change = () => {
      setHash(window.location.hash);
      setCreate(false);
    };
    const open = () => setCreate(true);
    window.addEventListener('hashchange', change);
    window.addEventListener('panel:create', open);
    return () => {
      window.removeEventListener('hashchange', change);
      window.removeEventListener('panel:create', open);
    };
  }, []);
  return (
    <div className="app-shell">
      <BrandHeader health={health} back={!!id} onCreate={id ? undefined : () => setCreate(true)} />
      {id ? (
        <DiscussionPage key={id} id={id} />
      ) : (
        <Home openCreate={create} onCloseCreate={() => setCreate(false)} />
      )}
      <Footer />
    </div>
  );
}
