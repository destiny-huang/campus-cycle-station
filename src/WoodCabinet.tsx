import { DEMO_ITEMS, SLOT_OVERRIDES, ZONE_CONFIGS, type DemoItem, type SlotStatus, type ZoneName } from './demo-data';

const statusLabels: Record<SlotStatus, string> = {
  empty: '空闲',
  reserved: '已预留',
  review: '待审核',
  available: '可领取',
  returned: '待移出',
  disabled: '停用',
};

function ItemDrawing({ icon }: { icon: DemoItem['icon'] }) {
  if (icon === 'book') {
    return <svg viewBox="0 0 72 58" aria-hidden="true"><path d="M8 12h27v38H8z" fill="#e8844e"/><path d="M37 12h27v38H37z" fill="#f1b45d"/><path d="M35 15c-8-5-18-6-23-4v33c8-2 16 0 23 5zM37 15c8-5 18-6 23-4v33c-8-2-16 0-23 5z" fill="#fff5cf" stroke="#4d6c58" strokeWidth="2"/></svg>;
  }
  if (icon === 'lamp') {
    return <svg viewBox="0 0 72 58" aria-hidden="true"><path d="M23 47h31" stroke="#527362" strokeWidth="4"/><path d="M39 44V27l12-10" stroke="#527362" strokeWidth="4"/><path d="M42 13l18-6 5 14-20 3z" fill="#f5ca57" stroke="#527362" strokeWidth="2"/><circle cx="39" cy="46" r="5" fill="#e27b49"/></svg>;
  }
  if (icon === 'ball') {
    return <svg viewBox="0 0 72 58" aria-hidden="true"><circle cx="36" cy="29" r="22" fill="#e98b43" stroke="#6b4a31" strokeWidth="2"/><path d="M15 29h42M36 7c-8 9-8 35 0 44M36 7c8 9 8 35 0 44M20 14c8 7 24 7 32 0M20 44c8-7 24-7 32 0" fill="none" stroke="#6b4a31" strokeWidth="2"/></svg>;
  }
  return <svg viewBox="0 0 72 58" aria-hidden="true"><path d="M18 19h36l5 33H13z" fill="#79a6c5" stroke="#405c67" strokeWidth="2"/><path d="M26 20c0-13 20-13 20 0" fill="none" stroke="#405c67" strokeWidth="4"/><path d="M22 29h28" stroke="#dcecf2" strokeWidth="3"/></svg>;
}

function slotId(zone: ZoneName, number: number) {
  return `${zone}${String(number).padStart(2, '0')}`;
}

type WoodCabinetProps = {
  zone: ZoneName;
  page: number;
  onPageChange: (page: number) => void;
  onSelectItem: (item: DemoItem, trigger: HTMLButtonElement) => void;
  className?: string;
  items?: DemoItem[];
  statusOverrides?: Partial<Record<string, SlotStatus>>;
};

export function WoodCabinet({ zone, page, onPageChange, onSelectItem, className = '', items = DEMO_ITEMS, statusOverrides = SLOT_OVERRIDES }: WoodCabinetProps) {
  const config = ZONE_CONFIGS[zone];
  const pageCount = Math.ceil(config.total / config.perPage);
  const start = page * config.perPage + 1;
  const slots = Array.from({ length: config.perPage }, (_, index) => {
    const number = start + index;
    if (number > config.total) return null;
    const id = slotId(zone, number);
    const item = items.find((candidate) => candidate.slot === id);
    const status = item?.status ?? statusOverrides[id] ?? 'empty';
    return { id, item, status };
  });
  const last = Math.min(start + config.perPage - 1, config.total);

  return (
    <section className={`cabinet-panel cabinet-${zone.toLowerCase()} ${className}`} aria-label={`${zone}区柜位`}>
      <header className="cabinet-sign">
        <strong>{zone}区</strong>
        <span>{config.label} · 共 {config.total} 格</span>
      </header>
      <div className="cabinet-top" />
      <div className="cabinet-frame">
        <div className="cabinet-grid" style={{ '--cabinet-columns': config.columns, '--cabinet-rows': config.rows } as React.CSSProperties}>
          {slots.map((slot, index) => slot ? (
            <button
              className={`cabinet-slot slot-${slot.status} ${slot.item ? 'has-item' : ''}`}
              key={slot.id}
              type="button"
              onClick={(event) => slot.item && onSelectItem(slot.item, event.currentTarget)}
              aria-label={`${slot.id}，${slot.item?.name ?? statusLabels[slot.status]}，${statusLabels[slot.status]}`}
            >
              <span className={`slot-state state-${slot.status}`}>{statusLabels[slot.status]}</span>
              {slot.item && <span className="slot-object"><ItemDrawing icon={slot.item.icon} /></span>}
              <span className="slot-label">{slot.id}</span>
            </button>
          ) : <span className="cabinet-slot slot-filler" aria-hidden="true" key={`filler-${index}`} />)}
        </div>
      </div>
      <div className="cabinet-base" />
      <footer className="cabinet-pager">
        <button type="button" onClick={() => onPageChange(page - 1)} disabled={page === 0} aria-label={`${zone}区上一板`}>←</button>
        <span>{start}–{last} / {config.total}</span>
        <span className="page-dots" aria-label={`第${page + 1}板，共${pageCount}板`}>
          {Array.from({ length: pageCount }, (_, index) => <i className={index === page ? 'active' : ''} key={index} />)}
        </span>
        <button type="button" onClick={() => onPageChange(page + 1)} disabled={page === pageCount - 1} aria-label={`${zone}区下一板`}>→</button>
      </footer>
    </section>
  );
}
