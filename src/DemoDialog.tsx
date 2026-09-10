import { useEffect, useRef } from 'react';
import type { DemoItem } from './demo-data';

const icons = { book: '📚', lamp: '💡', ball: '🏀', bag: '🎒' };

export function DemoDialog({ item, onClose }: { item: DemoItem; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="demo-dialog" role="dialog" aria-modal="true" aria-labelledby="demo-dialog-title">
        <button ref={closeRef} className="dialog-close" type="button" onClick={onClose} aria-label="关闭示例详情">×</button>
        <p className="paper-kicker">示例物品详情 · 非真实库存</p>
        <div className="dialog-illustration" aria-hidden="true">{icons[item.icon]}</div>
        <h2 id="demo-dialog-title">{item.name}</h2>
        <dl>
          <div><dt>示例柜位</dt><dd>{item.slot}</dd></div>
          <div><dt>示例积分</dt><dd>{item.points} 分</dd></div>
          <div><dt>示例状态</dt><dd>{item.status === 'available' ? '可领取' : '待审核'}</dd></div>
          <div><dt>外观描述</dt><dd>{item.condition}</dd></div>
        </dl>
        <p>{item.note}</p>
        <button className="primary-action" type="button" disabled>真实操作待开发</button>
      </section>
    </div>
  );
}
