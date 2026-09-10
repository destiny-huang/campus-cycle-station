import { useState } from 'react';
import { type DemoItem, type ZoneName } from './demo-data';
import { WoodCabinet } from './WoodCabinet';

export function LockerWallPage({ onSelectItem }: { onSelectItem: (item: DemoItem, trigger: HTMLButtonElement) => void }) {
  const [pages, setPages] = useState<Record<ZoneName, number>>({ A: 0, B: 0, C: 0 });
  const [mobileZone, setMobileZone] = useState<ZoneName>('A');
  const zones: ZoneName[] = ['A', 'B', 'C'];

  return (
    <div className="locker-page">
      <header className="locker-heading">
        <div><p className="section-kicker">展示设计样例 · 非实时库存</p><h1>卡通实木柜墙</h1><p>三组柜体共 170 格；分页仅用于展示，不代表新增线下柜体。</p></div>
        <ul className="status-legend"><li className="available">可领取</li><li className="reserved">已预留</li><li className="review">待审核</li><li className="disabled">停用</li></ul>
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
          />
        ))}
      </div>
      <p className="cabinet-note">编号由配置生成并完整覆盖 A01–A100、B01–B50、C01–C20。真实 FIFO、预留与领取状态待后续业务阶段接入。</p>
    </div>
  );
}
