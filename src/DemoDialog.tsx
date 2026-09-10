import { useEffect, useRef, useState } from 'react';
import { postJson, type Redemption, type Session, type Student } from './api';
import type { DemoItem } from './demo-data';

const icons = { book: '📚', lamp: '💡', ball: '🏀', bag: '🎒' };
const statusLabels = { empty: '空闲', reserved: '待投放', review: '待审核', available: '审核通过', returned: '待移出', disabled: '停用' };

export function DemoDialog({ item, session, onClose, onRedeemed }: {
  item: DemoItem; session: Session | null; onClose: () => void; onRedeemed: (student: Student) => Promise<void>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [success, setSuccess] = useState<Redemption | null>(null);
  const [requestKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function redeem() {
    if (!item.donationId) return;
    setBusy(true); setMessage('');
    try {
      const result = await postJson<{ redemption: Redemption; student: Student }>(`/api/student/donations/${item.donationId}/redeem`, { idempotencyKey: requestKey });
      setSuccess(result.redemption); await onRedeemed(result.student);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  const canRedeem = item.isReal && item.status === 'available' && Boolean(item.donationId);
  const student = session?.role === 'student' ? session.student : null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="demo-dialog" role="dialog" aria-modal="true" aria-labelledby="demo-dialog-title">
        <button ref={closeRef} className="dialog-close" type="button" onClick={onClose} aria-label="关闭物品详情">×</button>
        <p className="paper-kicker">{item.isReal ? '真实柜位物品' : '示例物品详情 · 非真实库存'}</p>
        {item.photoUrl ? <img className="dialog-photo" src={item.photoUrl} alt={`${item.name}原图`} /> : <div className="dialog-illustration" aria-hidden="true">{icons[item.icon]}</div>}
        <h2 id="demo-dialog-title">{item.name}</h2>
        <dl>
          <div><dt>{item.isReal ? '柜位' : '示例柜位'}</dt><dd>{item.slot}</dd></div>
          <div><dt>{item.isReal ? '领取积分' : '示例积分'}</dt><dd>{item.points} 分</dd></div>
          <div><dt>状态</dt><dd>{statusLabels[item.status]}</dd></div>
          <div><dt>外观描述</dt><dd>{item.condition}</dd></div>
        </dl>
        <p>{item.note}</p>
        {success ? <div className="redemption-success" role="status"><strong>领取成功，请前往 {success.slotId} 柜位取走物品</strong><small>已扣除 {success.pointsSpent} 分，历史记录保留领取时柜位。</small></div>
          : canRedeem && student && confirming ? <div className="redemption-confirm"><strong>确认领取</strong><p>{item.name} · 需要 {item.points} 分</p><p>当前余额 {student.balance} 分 · 柜位 {item.slot}</p>{message && <p className="dialog-error">{message}</p>}<div><button type="button" onClick={() => setConfirming(false)}>返回</button><button className="real-action" type="button" onClick={redeem} disabled={busy}>{busy ? '处理中…' : '确认领取'}</button></div></div>
          : canRedeem && student ? <button className="real-action dialog-redeem" type="button" onClick={() => setConfirming(true)}>领取这件物品</button>
          : <button className="primary-action" type="button" disabled>{canRedeem ? '请先登录学生端' : '当前无可用操作'}</button>}
      </section>
    </div>
  );
}
