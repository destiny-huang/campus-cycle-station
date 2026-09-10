import { useEffect, useRef, useState } from 'react';
import { api, type Session } from './api';
import { DemoDialog } from './DemoDialog';
import { HomePage } from './HomePage';
import { LockerWallPage } from './LockerWallPage';
import { StudentPage } from './StudentPage';
import { TeacherPage } from './TeacherPage';
import type { DemoItem } from './demo-data';

type PageKey = 'home' | 'student' | 'teacher' | 'locker-wall';
type HealthState = 'loading' | 'ready' | 'error';
const routes: Record<Exclude<PageKey, 'home'>, { path: string; label: string }> = {
  student: { path: '/student', label: '学生端' }, teacher: { path: '/teacher', label: '教师端' },
  'locker-wall': { path: '/locker-wall', label: '柜位展示' },
};

function pageFromPath(pathname: string): PageKey {
  if (pathname === '/') return 'home';
  return (Object.entries(routes) as [Exclude<PageKey, 'home'>, { path: string; label: string }][])
    .find(([, route]) => route.path === pathname)?.[0] ?? 'home';
}

function HealthBadge({ health }: { health: HealthState }) {
  const copy = health === 'ready' ? '服务正常' : health === 'error' ? '服务未连接' : '连接中';
  return <span className={`health-badge health-${health}`}><i />{copy}</span>;
}

export default function App() {
  const [page, setPage] = useState<PageKey>(() => pageFromPath(window.location.pathname));
  const [health, setHealth] = useState<HealthState>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [selectedItem, setSelectedItem] = useState<DemoItem | null>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);

  async function refreshSession() {
    const current = await api<Session>('/api/session');
    setSession(current);
    return current;
  }

  useEffect(() => {
    const onPopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error(); setHealth('ready'); return refreshSession();
    }).catch((error: unknown) => { if ((error as { name?: string }).name !== 'AbortError') setHealth('error'); });
    return () => controller.abort();
  }, []);

  function navigate(next: PageKey) { window.history.pushState({}, '', next === 'home' ? '/' : routes[next].path); setPage(next); }
  function openItem(item: DemoItem, trigger: HTMLButtonElement) { lastTrigger.current = trigger; setSelectedItem(item); }
  function closeItem() { setSelectedItem(null); window.setTimeout(() => lastTrigger.current?.focus(), 0); }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate('home')}><span className="brand-mark">循</span><span><strong>校园循环站</strong><small>Campus Cycle Station</small></span></button>
        <nav aria-label="页面入口">{(Object.keys(routes) as Exclude<PageKey, 'home'>[]).map((key) => <button className={page === key ? 'active' : ''} key={key} type="button" onClick={() => navigate(key)}>{routes[key].label}</button>)}</nav>
        <HealthBadge health={health} />
      </header>
      <main>
        {page === 'home' && <HomePage session={session} refreshSession={refreshSession} navigate={navigate} />}
        {page === 'student' && <StudentPage session={session} refreshSession={refreshSession} onSelectItem={openItem} onLoggedOut={() => navigate('home')} />}
        {page === 'teacher' && <TeacherPage session={session} refreshSession={refreshSession} onLoggedOut={() => navigate('home')} />}
        {page === 'locker-wall' && <LockerWallPage onSelectItem={openItem} />}
      </main>
      <footer><span>M4 捐赠、领取与柜位闭环</span><span>{session?.mode === 'demo' ? '演示环境' : '正式本地环境'} · 真实 AI 待开发</span></footer>
      {selectedItem && <DemoDialog item={selectedItem} session={session} onClose={closeItem} onRedeemed={async () => {
        await refreshSession();
        window.dispatchEvent(new Event('cycle-inventory-changed'));
      }} />}
    </div>
  );
}
