import { useEffect, useRef, useState } from 'react';
import { App as NativeApp } from '@capacitor/app';
import { api, type Session } from './api';
import { DemoDialog } from './DemoDialog';
import { HomePage } from './HomePage';
import { LockerWallPage } from './LockerWallPage';
import { PwaInstall } from './PwaInstall';
import { StudentPage } from './StudentPage';
import { TeacherPage } from './TeacherPage';
import type { DemoItem } from './demo-data';
import { apiUrl, isNativeApp } from './platform';

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
  const [online, setOnline] = useState(navigator.onLine);
  const [backHint, setBackHint] = useState(false);
  const [showNativeLaunch, setShowNativeLaunch] = useState(isNativeApp);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const lastBackPress = useRef(0);

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
    if (!showNativeLaunch) return;
    const timer = window.setTimeout(() => setShowNativeLaunch(false), 850);
    return () => window.clearTimeout(timer);
  }, [showNativeLaunch]);

  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); };
  }, []);

  useEffect(() => {
    if (!isNativeApp) return;
    let disposed = false;
    let listener: { remove: () => Promise<void> } | undefined;
    void NativeApp.addListener('backButton', ({ canGoBack }) => {
      if (selectedItem) { closeItem(); return; }
      if (canGoBack && window.location.pathname !== '/student') { window.history.back(); return; }
      const now = Date.now();
      if (now - lastBackPress.current < 1800) { void NativeApp.exitApp(); return; }
      lastBackPress.current = now;
      setBackHint(true);
      window.setTimeout(() => setBackHint(false), 1800);
    }).then((handle) => { if (disposed) void handle.remove(); else listener = handle; });
    return () => { disposed = true; if (listener) void listener.remove(); };
  }, [selectedItem]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(apiUrl('/api/health'), { signal: controller.signal, credentials: 'include' }).then((response) => {
      if (!response.ok) throw new Error(); setHealth('ready'); return refreshSession();
    }).catch((error: unknown) => { if ((error as { name?: string }).name !== 'AbortError') setHealth('error'); });
    return () => controller.abort();
  }, []);

  function navigate(next: PageKey) { window.history.pushState({}, '', next === 'home' ? '/' : routes[next].path); setPage(next); }
  function openItem(item: DemoItem, trigger: HTMLButtonElement) { lastTrigger.current = trigger; setSelectedItem(item); }
  function closeItem() { setSelectedItem(null); window.setTimeout(() => lastTrigger.current?.focus(), 0); }

  return (
    <div className="app-shell">
      {showNativeLaunch && <div className="native-launch" aria-label="校园循环站正在启动"><span className="native-launch-mark">循</span><strong>校园循环站</strong><small>让闲置物品继续发光</small></div>}
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate('home')}><span className="brand-mark">循</span><span><strong>校园循环站</strong><small>Campus Cycle Station</small></span></button>
        <nav aria-label="页面入口">{(Object.keys(routes) as Exclude<PageKey, 'home'>[]).map((key) => <button className={page === key ? 'active' : ''} key={key} type="button" onClick={() => navigate(key)}>{routes[key].label}</button>)}</nav>
        <div className="topbar-actions"><PwaInstall /><HealthBadge health={health} /></div>
      </header>
      <main>
        {(!online || (isNativeApp && health === 'error')) && <div className="network-offline" role="status">暂时无法连接校园循环站，请检查网络后重试。</div>}
        {page === 'home' && <HomePage session={session} refreshSession={refreshSession} navigate={navigate} />}
        {page === 'student' && <StudentPage session={session} refreshSession={refreshSession} onSelectItem={openItem} onLoggedOut={() => navigate('home')} />}
        {page === 'teacher' && <TeacherPage session={session} refreshSession={refreshSession} onLoggedOut={() => navigate('home')} />}
        {page === 'locker-wall' && <LockerWallPage onSelectItem={openItem} />}
      </main>
      <footer><span>M5 OpenRouter AI体验</span><span>{session?.mode === 'demo' ? '演示环境' : '正式本地环境'} · AI失败不影响核心流程</span></footer>
      {selectedItem && <DemoDialog item={selectedItem} session={session} onClose={closeItem} onRedeemed={async () => {
        await refreshSession();
        window.dispatchEvent(new Event('cycle-inventory-changed'));
      }} />}
      {backHint && <div className="native-back-hint" role="status">再按一次退出应用</div>}
    </div>
  );
}
