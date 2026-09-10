import { useEffect, useRef } from 'react';
import type { DemoItem } from './demo-data';

const icons = { book: '📚', lamp: '💡', ball: '🏀', bag: '🎒' };
const statusLabels = { empty: '空闲', reserved: '待投放', review: '待审核', available: '审核通过', returned: '待移出', disabled: '停用' };

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
        <button ref={closeRef} className="dialog-close" type="button" onClick={onClose} aria-label="关闭物品详情">×</button>
        <p className="paper-kicker">{item.isReal ? '真实柜位物品' : '示例物品详情 · 非真实库存'}</p>
        {item.photoUrl ? <img className="dialog-photo" src={item.photoUrl} alt={`${item.name}原图`} /> : <div className="dialog-illustration" aria-hidden="true">{icons[item.icon]}</div>}
        <h2 id="demo-dialog-title">{item.name}</h2>
        <dl>
          <div><dt>{item.isReal ? '柜位' : '示例柜位'}</dt><dd>{item.slot}</dd></div>
          <div><dt>{item.isReal ? '审核积分' : '示例积分'}</dt><dd>{item.points} 分</dd></div>
          <div><dt>状态</dt><dd>{statusLabels[item.status]}</dd></div>
          <div><dt>外观描述</dt><dd>{item.condition}</dd></div>
        </dl>
        <p>{item.note}</p>
        <button className="primary-action" type="button" disabled>{item.isReal && item.status === 'available' ? '领取入口下一阶段开放' : '当前无可用操作'}</button>
      </section>
    </div>
  );
}
