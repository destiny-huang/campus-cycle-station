import { useEffect, useRef, useState } from 'react';
import { DemoDialog } from './DemoDialog';
import { LockerWallPage } from './LockerWallPage';
import { StudentPage } from './StudentPage';
import { TeacherPage } from './TeacherPage';
import type { DemoItem } from './demo-data';

type PageKey = 'student' | 'teacher' | 'locker-wall';
type HealthState = 'loading' | 'ready' | 'error';

const routes: Record<PageKey, { path: string; label: string }> = {
  student: { path: '/student', label: '学生端' },
  teacher: { path: '/teacher', label: '教师端' },
  'locker-wall': { path: '/locker-wall', label: '柜位展示' },
};

function pageFromPath(pathname: string): PageKey {
  return (Object.entries(routes) as [PageKey, (typeof routes)[PageKey]][])
    .find(([, route]) => route.path === pathname)?.[0] ?? 'student';
}

function HealthBadge({ health }: { health: HealthState }) {
  const copy = health === 'ready' ? '服务正常' : health === 'error' ? '服务未连接' : '连接中';
  return <span className={`health-badge health-${health}`}><i />{copy}</span>;
}

export default function App() {
  const [page, setPage] = useState<PageKey>(() => pageFromPath(window.location.pathname));
  const [health, setHealth] = useState<HealthState>('loading');
  const [selectedItem, setSelectedItem] = useState<DemoItem | null>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onPopState = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
      .then(() => setHealth('ready'))
      .catch((error: unknown) => { if ((error as { name?: string }).name !== 'AbortError') setHealth('error'); });
    return () => controller.abort();
  }, []);

  function navigate(next: PageKey) {
    window.history.pushState({}, '', routes[next].path);
    setPage(next);
  }

  function openItem(item: DemoItem, trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    setSelectedItem(item);
  }

  function closeItem() {
    setSelectedItem(null);
    window.setTimeout(() => lastTrigger.current?.focus(), 0);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate('student')}>
          <span className="brand-mark">循</span><span><strong>校园循环站</strong><small>Campus Cycle Station</small></span>
        </button>
        <nav aria-label="页面入口">
          {(Object.keys(routes) as PageKey[]).map((key) => <button className={page === key ? 'active' : ''} key={key} type="button" onClick={() => navigate(key)}>{routes[key].label}</button>)}
        </nav>
        <HealthBadge health={health} />
      </header>
      <main>
        {page === 'student' && <StudentPage onSelectItem={openItem} />}
        {page === 'teacher' && <TeacherPage />}
        {page === 'locker-wall' && <LockerWallPage onSelectItem={openItem} />}
      </main>
      <footer><span>M1.1 活泼卡通风 · 界面演示</span><span>业务状态：待开发 · AI：mock</span></footer>
      {selectedItem && <DemoDialog item={selectedItem} onClose={closeItem} />}
    </div>
  );
}
