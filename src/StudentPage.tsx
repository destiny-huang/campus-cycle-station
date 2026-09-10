import { useState } from 'react';
import { DEMO_ITEMS, type DemoItem } from './demo-data';

const itemIcons = { book: '📚', lamp: '💡', ball: '🏀', bag: '🎒' };

export function StudentPage({ onSelectItem }: { onSelectItem: (item: DemoItem, trigger: HTMLButtonElement) => void }) {
  const [category, setCategory] = useState('全部');
  const [notice, setNotice] = useState('');
  const categories = ['全部', ...new Set(DEMO_ITEMS.map((item) => item.category))];
  const items = category === '全部' ? DEMO_ITEMS : DEMO_ITEMS.filter((item) => item.category === category);

  return (
    <div className="student-page">
      <section className="student-intro">
        <div className="student-copy">
          <p className="section-kicker">界面演示 · 尚未接入业务</p>
          <h1>你好，同学！</h1>
          <p>把闲置交给下一位需要它的人。</p>
        </div>
        <div className="campus-scene" aria-hidden="true">
          <i className="tree tree-one" /><i className="building building-one" />
          <i className="building building-two" /><i className="tree tree-two" />
          <span className="sun" />
        </div>
        <div className="points-board"><span>示例账户</span><strong>200</strong><small>积分</small></div>
      </section>

      <section className="student-actions" aria-label="学生主要入口">
        {[
          ['捐', '捐赠物品', '提交一件闲置物品'],
          ['寻', '浏览物品', '查看示例物品'],
          ['记', '我的记录', '捐赠与领取记录'],
        ].map(([icon, title, detail]) => (
          <button type="button" key={title} onClick={() => setNotice(`${title}为界面演示，真实功能待开发。`)}>
            <span className="action-icon">{icon}</span>
            <span><strong>{title}</strong><small>{detail}</small></span><b>→</b>
          </button>
        ))}
      </section>
      {notice && <p className="inline-notice" role="status">{notice}</p>}

      <section className="preview-section">
        <header className="section-heading">
          <div><p className="section-kicker">只读演示数据</p><h2>物品预览</h2></div>
          <div className="filter-row">
            {categories.map((value) => <button className={category === value ? 'active' : ''} type="button" key={value} onClick={() => setCategory(value)}>{value}</button>)}
          </div>
        </header>
        <div className="item-strip">
          {items.map((item) => (
            <button className="preview-item" type="button" key={item.id} onClick={(event) => onSelectItem(item, event.currentTarget)}>
              <span className={`preview-art art-${item.icon}`}>{itemIcons[item.icon]}</span>
              <span className="preview-copy"><strong>{item.name}</strong><small>{item.slot} · 示例 {item.points} 分</small></span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
