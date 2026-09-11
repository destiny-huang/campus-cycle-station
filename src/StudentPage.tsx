import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { api, postJson, type Donation, type LedgerEntry, type Redemption, type Session, type Student } from './api';
import { DEMO_ITEMS, type DemoItem } from './demo-data';
import { OnboardingTutorial } from './OnboardingTutorial';
import { AiAssistant } from './AiAssistant';

const itemIcons = { book: '📚', lamp: '💡', ball: '🏀', bag: '🎒' };
const categories = [
  ['writing', '普通书写工具'], ['consumable', '小型文具耗材'], ['drawing', '基础绘图工具'],
  ['notebook', '本册与文件收纳'], ['pencil_case', '文具收纳用品'], ['book', '图书'],
  ['materials', '手工材料与学习套件'], ['puzzle', '棋类与益智用品'], ['sports', '体育用品'], ['durable', '较高价值耐用品'],
] as const;
const conditions = [['near_new', '近新'], ['normal', '正常使用痕迹'], ['worn_but_complete', '磨损但完整']] as const;
const statusLabels: Record<Donation['status'], string> = {
  pending_dropoff: '待投放', pending_review: '已投放 · 待审核', approved: '审核通过 · 已上架',
  returned: '已退回 · 待取出', cancelled: '已取消', returned_removed: '已退回并移出', redeemed: '已领取',
};
type Profile = { student: Student; ledger: LedgerEntry[] };

function readPhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('照片读取失败'));
    reader.readAsDataURL(file);
  });
}

export function StudentPage({ session, refreshSession, onSelectItem, onLoggedOut }: {
  session: Session | null;
  refreshSession: () => Promise<Session>;
  onSelectItem: (item: DemoItem, trigger: HTMLButtonElement) => void;
  onLoggedOut: () => void;
}) {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [donations, setDonations] = useState<Donation[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [issueFor, setIssueFor] = useState<number | null>(null);
  const [issueText, setIssueText] = useState('');
  const [issueKey, setIssueKey] = useState(() => crypto.randomUUID());
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [category, setCategory] = useState('全部');
  const [itemName, setItemName] = useState('');
  const [categoryId, setCategoryId] = useState('book');
  const [condition, setCondition] = useState('normal');
  const [description, setDescription] = useState('');
  const [zone, setZone] = useState<'A' | 'B' | 'C'>('A');
  const [photoDataUrl, setPhotoDataUrl] = useState('');
  const [photoName, setPhotoName] = useState('');
  const [donationKey, setDonationKey] = useState(() => crypto.randomUUID());
  const [completed, setCompleted] = useState<Donation | null>(null);
  const donationRef = useRef<HTMLElement>(null);
  const previewCategories = ['全部', ...new Set(DEMO_ITEMS.map((item) => item.category))];
  const items = category === '全部' ? DEMO_ITEMS : DEMO_ITEMS.filter((item) => item.category === category);

  async function loadStudentData() {
    const [account, records, claims] = await Promise.all([
      api<Profile>('/api/student/me'), api<{ donations: Donation[] }>('/api/student/donations'),
      api<{ redemptions: Redemption[] }>('/api/student/redemptions'),
    ]);
    setProfile(account); setDonations(records.donations); setRedemptions(claims.redemptions);
  }

  useEffect(() => {
    if (session?.role !== 'student') { setProfile(null); setDonations([]); setRedemptions([]); return; }
    if (session.student?.onboardingCompletedAt === null) setShowTutorial(true);
    void loadStudentData().catch((error: Error) => setMessage(error.message));
  }, [session]);

  useEffect(() => {
    if (!donations.some((item) => item.aiStatus === 'pending' || item.aiStatus === 'running')) return;
    const timer = window.setInterval(() => void loadStudentData().catch(() => undefined), 2500);
    return () => window.clearInterval(timer);
  }, [donations]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await postJson('/api/auth/student', { name, studentId }); await refreshSession(); setName(''); setStudentId(''); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try { await postJson('/api/auth/logout', {}); await refreshSession(); setProfile(null); setDonations([]); setShowTutorial(false); onLoggedOut(); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setMessage('请选择 3MB 以内的 JPEG、PNG 或 WebP 图片'); event.target.value = ''; return;
    }
    try { setPhotoDataUrl(await readPhoto(file)); setPhotoName(file.name); setMessage(''); }
    catch (error) { setMessage((error as Error).message); }
  }

  async function submitDonation(event: FormEvent) {
    event.preventDefault();
    if (!photoDataUrl) { setMessage('请先选择一张真实物品照片'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await postJson<{ donation: Donation; duplicate: boolean }>('/api/student/donations', {
        name: itemName, categoryId, condition, description, zone, photoDataUrl, idempotencyKey: donationKey,
      });
      setCompleted(result.donation);
      setMessage(result.duplicate ? '该申请已存在，没有重复占用柜位。' : `申请已创建，请将物品放入 ${result.donation.slotId}。提交申请不会立即发积分。`);
      await loadStudentData();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  function continueDonation() {
    setCompleted(null); setItemName(''); setDescription(''); setPhotoDataUrl(''); setPhotoName('');
    setDonationKey(crypto.randomUUID()); setMessage('已开启一件新的捐赠申请。');
    window.setTimeout(() => donationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function updateDonation(donation: Donation, action: 'deposit' | 'cancel') {
    setBusy(true); setMessage('');
    try {
      const result = await postJson<{ donation: Donation; duplicate: boolean }>(`/api/student/donations/${donation.id}/${action}`, {});
      setMessage(result.duplicate ? '该操作已处理，没有重复改变柜位。' : action === 'deposit' ? '已标记投放，等待教师核实；此时仍不会发积分。' : '申请已取消，柜位已回到本区队尾。');
      await loadStudentData();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function reportIssue(redemption: Redemption) {
    setBusy(true); setMessage('');
    try {
      await postJson(`/api/student/redemptions/${redemption.id}/issues`, { description: issueText, idempotencyKey: issueKey });
      setMessage('柜位异常已记录，教师会人工处理；系统不会自动退款或调分。');
      setIssueFor(null); setIssueText(''); setIssueKey(crypto.randomUUID());
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function finishTutorial() {
    await postJson('/api/student/onboarding/complete', {});
    await refreshSession();
    setShowTutorial(false);
  }

  const student = profile?.student ?? (session?.role === 'student' ? session.student : null);

  return (
    <div className="student-page">
      <section className="student-intro">
        <div className="student-copy"><p className="section-kicker">{session?.mode === 'demo' ? '演示环境' : '校园循环站'}</p><h1>{student ? `你好，${student.name}！` : '你好，同学！'}</h1><p>{student ? `${student.className} · ${student.studentId}` : '使用学校已导入名单中的姓名和学号登录。'}</p></div>
        <div className="campus-scene" aria-hidden="true"><i className="tree tree-one" /><i className="building building-one" /><i className="building building-two" /><i className="tree tree-two" /><span className="sun" /></div>
        <div className="points-board"><span>{student ? '当前余额' : '登录后查看'}</span><strong>{student?.balance ?? '—'}</strong><small>积分</small></div>
      </section>

      {session?.role === 'teacher' ? <section className="auth-panel compact-auth"><p>当前是教师会话，请先退出教师端再登录学生账号。</p><button type="button" onClick={logout} disabled={busy}>退出教师会话</button></section>
        : !student ? <section className="auth-panel"><div><p className="section-kicker">学生登录</p><h2>姓名＋学号</h2><p>姓名必须与同一学号对应；无需学生密码、验证码或激活码。</p></div><form onSubmit={login}><label>姓名<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label><label>学号<input value={studentId} onChange={(event) => setStudentId(event.target.value)} autoComplete="username" required /></label><button className="real-action" type="submit" disabled={busy}>{busy ? '登录中…' : '登录'}</button></form></section>
        : <section className="account-panel"><header><div><p className="section-kicker">真实数据库余额</p><h2>我的积分流水</h2></div><button type="button" onClick={logout} disabled={busy}>退出登录</button></header><div className="ledger-list">{profile?.ledger.map((entry) => <article key={entry.id}><span className={entry.amount >= 0 ? 'ledger-plus' : 'ledger-minus'}>{entry.amount >= 0 ? '+' : ''}{entry.amount}</span><div><strong>{entry.reason}</strong><small>{entry.source === 'initial' ? '初始积分' : entry.source === 'labor' ? '劳动奖励' : entry.source === 'donation' ? '捐赠审核' : '领取扣分'} · {new Date(entry.createdAt).toLocaleString('zh-CN')}</small></div></article>)}{profile && profile.ledger.length === 0 && <p>暂无积分流水</p>}{!profile && <p>正在读取积分流水…</p>}</div></section>}
      {message && <p className="inline-notice" role="status">{message}</p>}

      <section className="student-actions" aria-label="学生入口">
        <button type="button" onClick={() => student ? donationRef.current?.scrollIntoView({ behavior: 'smooth' }) : setMessage('请先登录后捐赠。')}><span className="action-icon">捐</span><span><strong>捐赠物品</strong><small>{student ? '单件申请与自动分柜' : '登录后使用'}</small></span><b>→</b></button>
        <button type="button" onClick={() => setMessage('请到柜位展示中查看并领取已上架的真实物品。')}><span className="action-icon">寻</span><span><strong>浏览物品</strong><small>已上架物品可领取</small></span><b>→</b></button>
        <button type="button" onClick={() => student ? donationRef.current?.scrollIntoView({ behavior: 'smooth' }) : setMessage('请先登录后查看记录。')}><span className="action-icon">记</span><span><strong>捐赠记录</strong><small>{student ? `${donations.length} 条真实记录` : '登录后查看'}</small></span><b>→</b></button>
      </section>
      {student && <div className="student-help-row"><button type="button" onClick={() => setShowTutorial(true)}>？ 使用帮助 / 新手教程</button></div>}

      {student && <section className="donation-workspace" ref={donationRef}>
        <header className="section-heading"><div><p className="section-kicker">M3 · 一次提交一件</p><h2>捐赠物品并自动分柜</h2></div><span>实际柜体尺寸尚未测量，请自行确认所选区域能放下物品</span></header>
        <div className="donation-grid">
          <form className="donation-form" onSubmit={submitDonation}>
            {completed ? <div className="donation-success"><p className="section-kicker">申请已保存</p><h3>{completed.name}</h3><strong>{completed.slotId}</strong><p>请放入该柜位，再点击记录中的“我已投放”。建议 {completed.suggestedPoints} 分仅为规则估分，教师审核前不会到账。</p><button className="real-action" type="button" onClick={continueDonation}>继续捐赠另一件</button></div> : <>
              <label>物品名称<input value={itemName} onChange={(event) => setItemName(event.target.value)} maxLength={100} required /></label>
              <label>类别<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>成色<select value={condition} onChange={(event) => setCondition(event.target.value)}>{conditions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label>尺寸区<select value={zone} onChange={(event) => setZone(event.target.value as 'A' | 'B' | 'C')}><option value="A">A区 · 小件</option><option value="B">B区 · 中件</option><option value="C">C区 · 大件</option></select></label>
              <label className="wide-field">说明<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} placeholder="完整程度、缺页或配件情况请如实填写" /></label>
              <label className="photo-picker wide-field">真实照片<input type="file" accept="image/jpeg,image/png,image/webp" onChange={selectPhoto} required={!photoDataUrl} /><small>{photoName || '支持 JPEG、PNG、WebP，最大 3MB；拍照背景尽量干净，避免个人信息。'}</small></label>
              <p className="rule-estimate wide-field">照片上传后 AI 会尝试识别物品和可见成色；积分仍由系统模板计算并由教师检查实物后确认。AI 不可用时自动保留规则估分。</p>
              <button className="real-action wide-field" type="submit" disabled={busy}>{busy ? '提交中…' : '提交单件申请并分配柜位'}</button>
            </>}
          </form>
          <div className="donation-records"><h3>我的捐赠记录</h3>{donations.map((donation) => <article key={donation.id} className={`donation-record status-${donation.status}`}><img src={donation.photoUrl} alt={`${donation.name}原图`} /><div><strong>{donation.name}</strong><small>{donation.slotId} · {statusLabels[donation.status]}</small><p>规则建议 {donation.suggestedPoints} 分{donation.aiSuggestedPoints === null ? '' : ` · AI识别后系统建议 ${donation.aiSuggestedPoints} 分`}{donation.finalPoints === null ? '' : ` · 最终 ${donation.finalPoints} 分`}</p><p className={`ai-state ai-${donation.aiStatus}`}>{donation.aiStatus === 'pending' || donation.aiStatus === 'running' ? 'AI正在分析' : donation.aiStatus === 'succeeded' ? `AI分析完成：${donation.aiResult?.objectName ?? '已识别'}` : donation.aiStatus === 'failed' ? '暂时无法分析，教师仍可正常审核' : 'AI服务暂未启用'}</p>{donation.returnReason && <p>退回原因：{donation.returnReason}</p>}<div className="record-actions">{donation.status === 'pending_dropoff' && <><button type="button" onClick={() => updateDonation(donation, 'deposit')} disabled={busy}>我已投放</button><button type="button" onClick={() => updateDonation(donation, 'cancel')} disabled={busy}>取消申请</button></>}{donation.status === 'approved' && <span>已上架 · 可在柜位展示中领取</span>}{donation.status === 'returned' && <span>请联系教师取出实物</span>}</div></div></article>)}{donations.length === 0 && <p>暂无捐赠记录。</p>}</div>
        </div>
      </section>}

      <section className="preview-section"><header className="section-heading"><div><p className="section-kicker">独立界面样例 · 不进入真实库存</p><h2>物品预览</h2></div><div className="filter-row">{previewCategories.map((value) => <button className={category === value ? 'active' : ''} type="button" key={value} onClick={() => setCategory(value)}>{value}</button>)}</div></header><div className="item-strip">{items.map((item) => <button className="preview-item" type="button" key={item.id} onClick={(event) => onSelectItem(item, event.currentTarget)}><span className={`preview-art art-${item.icon}`}>{itemIcons[item.icon]}</span><span className="preview-copy"><strong>{item.name}</strong><small>{item.slot} · 示例 {item.points} 分</small></span></button>)}</div></section>
      {student && <section className="redemption-history">
        <header className="section-heading"><div><p className="section-kicker">M4 · 真实记录</p><h2>我的领取记录</h2></div><span>保留领取时的积分、照片和柜位</span></header>
        <div className="redemption-list">
          {redemptions.map((claim) => <article key={claim.id}>
            <img src={claim.photoUrl} alt={`${claim.itemName}领取原图`} />
            <div><strong>{claim.itemName}</strong><small>消耗 {claim.pointsSpent} 分 · 领取时柜位 {claim.slotId}</small><time>{new Date(claim.createdAt).toLocaleString('zh-CN')}</time></div>
            {issueFor === claim.id ? <div className="issue-form"><textarea value={issueText} onChange={(event) => setIssueText(event.target.value)} maxLength={300} placeholder="例如：柜内没有物品、柜内仍有旧物" /><button className="real-action" type="button" disabled={busy || issueText.trim().length < 2} onClick={() => reportIssue(claim)}>提交异常</button></div>
              : <button type="button" onClick={() => { setIssueFor(claim.id); setIssueKey(crypto.randomUUID()); }}>柜位异常</button>}
          </article>)}
          {redemptions.length === 0 && <p>暂无领取记录；请在柜位展示中领取已上架物品。</p>}
        </div>
        <p>异常反馈交由教师人工处理，不会自动退款或调分。</p>
      </section>}
      {student && showTutorial && <OnboardingTutorial onComplete={finishTutorial} onSkip={finishTutorial} />}
      {student && <AiAssistant />}
    </div>
  );
}
