import { useEffect, useState } from 'react';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

export function PwaInstall() {
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); setShowHelp(false); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  async function install() {
    if (!promptEvent) { setShowHelp((value) => !value); return; }
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setPromptEvent(null);
  }

  return <div className="pwa-install">
    <button type="button" onClick={() => void install()}>{promptEvent ? '安装应用' : '安装到手机'}</button>
    {showHelp && <aside className="pwa-install-help" role="dialog" aria-label="安装校园循环站">
      <button className="pwa-help-close" type="button" aria-label="关闭" onClick={() => setShowHelp(false)}>×</button>
      <strong>把循环站放到桌面</strong>
      <p>iPhone / iPad：在 Safari 点“分享”，再选“添加到主屏幕”。</p>
      <p>Android / 电脑：打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。</p>
    </aside>}
  </div>;
}
