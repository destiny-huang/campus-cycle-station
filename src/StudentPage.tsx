import { useEffect, useState, type FormEvent } from 'react';
import { api, postJson, type LedgerEntry, type Session, type Student } from './api';
import { DEMO_ITEMS, type DemoItem } from './demo-data';

const itemIcons = { book: '📚', lamp: '💡', ball: '🏀', bag: '🎒' };
type Profile = { student: Student; ledger: LedgerEntry[] };

export function StudentPage({ session, refreshSession, onSelectItem }: {
  session: Session | null;
  refreshSession: () => Promise<Session>;
  onSelectItem: (item: DemoItem, trigger: HTMLButtonElement) => void;
}) {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('全部');
  const categories = ['全部', ...new Set(DEMO_ITEMS.map((item) => item.category))];
  const items = category === '全部' ? DEMO_ITEMS : DEMO_ITEMS.filter((item) => item.category === category);

  useEffect(() => {
    if (session?.role !== 'student') { setProfile(null); return; }
    void api<Profile>('/api/student/me').then(setProfile).catch((error: Error) => setMessage(error.message));
  }, [session]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await postJson('/api/auth/student', { name, studentId });
      await refreshSession();
      setName(''); setStudentId('');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try { await postJson('/api/auth/logout', {}); await refreshSession(); setProfile(null); setMessage('已退出登录'); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  const student = profile?.student ?? (session?.role === 'student' ? session.student : null);

  return (
    <div className="student-page">
      <section className="student-intro">
        <div className="student-copy">
          <p className="section-kicker">{session?.mode === 'demo' ? '演示环境' : '校园循环站'}</p>
          <h1>{student ? `你好，${student.name}！` : '你好，同学！'}</h1>
          <p>{student ? `${student.className} · ${student.studentId}` : '使用学校已导入名单中的姓名和学号登录。'}</p>
        </div>
        <div className="campus-scene" aria-hidden="true"><i className="tree tree-one" /><i className="building building-one" /><i className="building building-two" /><i className="tree tree-two" /><span className="sun" /></div>
        <div className="points-board"><span>{student ? '当前余额' : '登录后查看'}</span><strong>{student?.balance ?? '—'}</strong><small>积分</small></div>
      </section>

      {session?.role === 'teacher' ? (
        <section className="auth-panel compact-auth"><p>当前是教师会话，请先退出教师端再登录学生账号。</p><button type="button" onClick={logout} disabled={busy}>退出教师会话</button></section>
      ) : !student ? (
        <section className="auth-panel">
          <div><p className="section-kicker">学生登录</p><h2>姓名＋学号</h2><p>姓名必须与同一学号对应；无需学生密码、验证码或激活码。</p></div>
          <form onSubmit={login}><label>姓名<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label><label>学号<input value={studentId} onChange={(event) => setStudentId(event.target.value)} autoComplete="username" required /></label><button className="real-action" type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button></form>
        </section>
      ) : (
        <section className="account-panel">
          <header><div><p className="section-kicker">真实数据库余额</p><h2>我的积分流水</h2></div><button type="button" onClick={logout} disabled={busy}>退出登录</button></header>
          <div className="ledger-list">
            {profile?.ledger.map((entry) => <article key={entry.id}><span className={entry.amount >= 0 ? 'ledger-plus' : 'ledger-minus'}>{entry.amount >= 0 ? '+' : ''}{entry.amount}</span><div><strong>{entry.reason}</strong><small>{entry.source === 'initial' ? '初始积分' : '劳动奖励'} · {new Date(entry.createdAt).toLocaleString('zh-CN')}</small></div></article>)}
            {profile && profile.ledger.length === 0 && <p>暂无积分流水</p>}
            {!profile && <p>正在读取积分流水…</p>}
          </div>
        </section>
      )}
      {message && <p className="inline-notice" role="status">{message}</p>}

      <section className="student-actions" aria-label="尚未开发的学生入口">
        {[[ '捐', '捐赠物品', 'M3 待开发' ],[ '寻', '浏览物品', '当前仅示例物品' ],[ '记', '业务记录', '捐赠与领取待开发' ]].map(([icon, title, detail]) => (
          <button type="button" key={title} onClick={() => setMessage(`${title}尚未接入真实业务。`)}><span className="action-icon">{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><b>→</b></button>
        ))}
      </section>

      <section className="preview-section">
        <header className="section-heading"><div><p className="section-kicker">界面示例 · 非真实库存</p><h2>物品预览</h2></div><div className="filter-row">{categories.map((value) => <button className={category === value ? 'active' : ''} type="button" key={value} onClick={() => setCategory(value)}>{value}</button>)}</div></header>
        <div className="item-strip">{items.map((item) => <button className="preview-item" type="button" key={item.id} onClick={(event) => onSelectItem(item, event.currentTarget)}><span className={`preview-art art-${item.icon}`}>{itemIcons[item.icon]}</span><span className="preview-copy"><strong>{item.name}</strong><small>{item.slot} · 示例 {item.points} 分</small></span></button>)}</div>
      </section>
    </div>
  );
}
