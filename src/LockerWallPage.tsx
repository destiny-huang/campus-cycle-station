import { useEffect, useMemo, useState } from 'react';
import { api, type LockerSlot } from './api';
import { type DemoItem, type SlotStatus, type ZoneName } from './demo-data';
import { WoodCabinet } from './WoodCabinet';

export function LockerWallPage({ onSelectItem }: { onSelectItem: (item: DemoItem, trigger: HTMLButtonElement) => void }) {
  const [pages, setPages] = useState<Record<ZoneName, number>>({ A: 0, B: 0, C: 0 });
  const [mobileZone, setMobileZone] = useState<ZoneName>('A');
  const [lockers, setLockers] = useState<LockerSlot[]>([]);
  const [message, setMessage] = useState('正在读取真实柜位…');
  const zones: ZoneName[] = ['A', 'B', 'C'];
  function loadLockers() {
    return api<{ lockers: LockerSlot[] }>('/api/lockers').then((result) => { setLockers(result.lockers); setMessage(''); });
  }
  useEffect(() => {
    void loadLockers().catch((error: Error) => setMessage(error.message));
    const refresh = () => void loadLockers().catch((error: Error) => setMessage(error.message));
    window.addEventListener('cycle-inventory-changed', refresh);
    return () => window.removeEventListener('cycle-inventory-changed', refresh);
  }, []);
  const items = useMemo<DemoItem[]>(() => lockers.flatMap((slot) => {
    if (!slot.donation) return [];
    const status: SlotStatus = slot.donation.status === 'pending_dropoff' ? 'reserved'
      : slot.donation.status === 'pending_review' ? 'review' : slot.donation.status === 'approved' ? 'available' : 'returned';
    const icon = slot.donation.categoryId === 'book' ? 'book' : slot.donation.categoryId === 'sports' ? 'ball'
      : slot.donation.categoryId === 'durable' ? 'bag' : 'lamp';
    return [{ id: `donation-${slot.donation.id}`, donationId: slot.donation.id, slot: slot.id, name: slot.donation.name,
      points: slot.donation.finalPoints ?? slot.donation.suggestedPoints, category: slot.donation.categoryId,
      icon, status, condition: slot.donation.condition, note: status === 'available'
        ? '教师已审核上架，学生登录后可确认领取。' : '这是当前真实柜位状态，暂不可领取。',
      photoUrl: status === 'available' ? slot.donation.photoUrl : undefined, isReal: true }];
  }), [lockers]);
  const statuses = useMemo(() => Object.fromEntries(lockers.map((slot) => [slot.id,
    slot.state === 'free' ? 'empty' : slot.donation?.status === 'pending_dropoff' ? 'reserved'
      : slot.donation?.status === 'pending_review' ? 'review' : slot.donation?.status === 'approved' ? 'available' : 'returned',
  ])) as Partial<Record<string, SlotStatus>>, [lockers]);

  return (
    <div className="locker-page">
      <header className="locker-heading">
        <div><p className="section-kicker">当前运行模式 · 真实柜位记录</p><h1>卡通实木柜墙</h1><p>三组柜体共 170 格；审核上架的真实物品可由学生领取。</p></div>
        <ul className="status-legend"><li className="available">已上架</li><li className="reserved">待投放</li><li className="review">待审核</li><li className="returned">待移出</li></ul>
      </header>
      <div className="zone-switch" aria-label="手机柜区切换">
        {zones.map((zone) => <button className={mobileZone === zone ? 'active' : ''} type="button" key={zone} onClick={() => setMobileZone(zone)}>{zone}区</button>)}
      </div>
      <div className="cabinet-wall-grid">
        {zones.map((zone) => (
          <WoodCabinet
            className={mobileZone === zone ? 'mobile-active' : ''}
            key={zone}
            zone={zone}
            page={pages[zone]}
            onPageChange={(page) => setPages((current) => ({ ...current, [zone]: page }))}
            onSelectItem={onSelectItem}
            items={items}
            statusOverrides={statuses}
          />
        ))}
      </div>
      <p className="cabinet-note">{message || '编号完整覆盖 A01–A100、B01–B50、C01–C20；各区空柜按持久化 FIFO 自动分配。'}</p>
    </div>
  );
}
