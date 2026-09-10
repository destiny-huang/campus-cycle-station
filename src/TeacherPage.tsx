import { useEffect, useState, type FormEvent } from 'react';
import { api, postJson, type Donation, type LockerIssue, type LockerSlot, type Redemption, type Session, type Student } from './api';

export function TeacherPage({ session, refreshSession }: { session: Session | null; refreshSession: () => Promise<Session> }) {
  const [password, setPassword] = useState('');
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [selected, setSelected] = useState<Student | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [rewardKey, setRewardKey] = useState(() => crypto.randomUUID());
  const [csv, setCsv] = useState('');
  const [csvName, setCsvName] = useState('');
  const [donations, setDonations] = useState<Donation[]>([]);
  const [lockers, setLockers] = useState<LockerSlot[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [issues, setIssues] = useState<LockerIssue[]>([]);
  const [reviewPoints, setReviewPoints] = useState<Record<number, string>>({});
  const [returnReasons, setReturnReasons] = useState<Record<number, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const authenticated = session?.role === 'teacher';

  async function loadStudents(search = query) {
    const result = await api<{ students: Student[] }>(`/api/teacher/students?query=${encodeURIComponent(search)}`);
    setStudents(result.students);
    if (selected) setSelected(result.students.find((student) => student.id === selected.id) ?? selected);
  }

  async function loadM3() {
    const [donationResult, lockerResult, redemptionResult, issueResult] = await Promise.all([
      api<{ donations: Donation[] }>('/api/teacher/donations'), api<{ lockers: LockerSlot[] }>('/api/teacher/lockers'),
      api<{ redemptions: Redemption[] }>('/api/teacher/redemptions'), api<{ issues: LockerIssue[] }>('/api/teacher/issues'),
    ]);
    setDonations(donationResult.donations); setLockers(lockerResult.lockers);
    setRedemptions(redemptionResult.redemptions); setIssues(issueResult.issues);
  }

  useEffect(() => {
    if (!authenticated) { setStudents([]); setSelected(null); setDonations([]); setLockers([]); setRedemptions([]); setIssues([]); return; }
    void loadM3().catch((error: Error) => setMessage(error.message));
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setTimeout(() => void loadStudents().catch((error: Error) => setMessage(error.message)), 220);
    return () => window.clearTimeout(timer);
  }, [authenticated, query]);

  async function teacherLogin(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try { await postJson('/api/auth/teacher', { password }); await refreshSession(); setPassword(''); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try { await postJson('/api/auth/logout', {}); await refreshSession(); setMessage('已退出教师端'); }
    catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function importCsv(event: FormEvent) {
    event.preventDefault();
    if (!csv) { setMessage('请先选择 CSV 文件'); return; }
    setBusy(true); setMessage('');
    try {
      const result = await postJson<{ created: number; updated: number; total: number }>('/api/teacher/import-csv', { csv });
      setMessage(`导入完成：新增 ${result.created} 人，更新 ${result.updated} 人，共 ${result.total} 行；已有余额未重置。`);
      await loadStudents(); setCsv(''); setCsvName('');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function reward(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true); setMessage('');
    try {
      const result = await postJson<{ duplicate: boolean; student: Student }>('/api/teacher/rewards', {
        studentId: selected.id, amount: Number(amount), reason, idempotencyKey: rewardKey,
      });
      setMessage(result.duplicate ? '该请求已处理，未重复增加积分。' : `已为 ${result.student.name} 发放 ${amount} 分并写入流水。`);
      setSelected(result.student); setAmount(''); setReason(''); setRewardKey(crypto.randomUUID()); await loadStudents();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function reviewDonation(donation: Donation, action: 'approve' | 'return') {
    setBusy(true); setMessage('');
    try {
      const body = action === 'approve'
        ? { action, finalPoints: Number(reviewPoints[donation.id] ?? donation.suggestedPoints) }
        : { action, reason: returnReasons[donation.id] ?? '' };
      const result = await postJson<{ duplicate: boolean; donation: Donation }>(`/api/teacher/donations/${donation.id}/review`, body);
      setMessage(result.duplicate ? '该审核已处理，没有重复发放积分。' : action === 'approve'
        ? `${donation.name} 已审核上架，积分已一次性写入学生账本。` : `${donation.name} 已退回；柜位继续占用，待确认实物移出。`);
      await Promise.all([loadM3(), loadStudents()]);
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  async function releaseReturned(donation: Donation) {
    setBusy(true); setMessage('');
    try {
      const result = await postJson<{ duplicate: boolean }>(`/api/teacher/donations/${donation.id}/release`, {});
      setMessage(result.duplicate ? '该柜位已经释放，没有重复入队。' : `${donation.slotId} 已确认清空，并回到 ${donation.zone} 区队尾。`);
      await loadM3();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  if (!authenticated) return <div className="teacher-page"><header className="teacher-heading"><div><p className="section-kicker">一个轻量教师端</p><h1>循环站管理</h1><p>教师口令仅从本地运行环境读取，不会写入页面或仓库。</p></div></header><section className="teacher-login auth-panel"><div><p className="section-kicker">教师登录</p><h2>输入本地教师口令</h2><p>{session?.role === 'student' ? '当前是学生会话，登录教师端将切换会话。' : '未登录教师不能导入名单、搜索学生、审核或发放积分。'}</p></div><form onSubmit={teacherLogin}><label>教师口令<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><button className="real-action" type="submit" disabled={busy}>{busy ? '登录中…' : '登录教师端'}</button></form></section>{message && <p className="inline-notice" role="status">{message}</p>}</div>;

  async function resolveIssue(issue: LockerIssue) {
    setBusy(true); setMessage('');
    try {
      const result = await postJson<{ duplicate: boolean }>(`/api/teacher/issues/${issue.id}/resolve`, {});
      setMessage(result.duplicate ? '该异常已经处理。' : `已将 ${issue.slotId} 柜位异常标记为已处理；未自动退款或调分。`);
      await loadM3();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  const pending = donations.filter((donation) => donation.status === 'pending_review' || donation.status === 'returned');
  const occupied = lockers.filter((slot) => slot.donation);
  const freeCounts = (['A', 'B', 'C'] as const).map((zone) => ({ zone, count: lockers.filter((slot) => slot.zone === zone && slot.state === 'free').length }));

  return (
    <div className="teacher-page">
      <header className="teacher-heading"><div><p className="section-kicker">教师端 · {session.mode === 'demo' ? '演示数据库' : '正式数据库'}</p><h1>循环站管理</h1><p>名单、积分、捐赠审核、领取和真实柜位已接入后端。</p></div><button className="text-action" type="button" onClick={logout} disabled={busy}>退出教师端</button></header>
      {message && <p className="inline-notice" role="status">{message}</p>}

      <section className="m3-review-section">
        <header className="section-heading"><div><p className="section-kicker">M3 · 实物核验后才发分</p><h2>待审核与待移出物品</h2></div><span>规则估分，未接真实 AI；教师可修改最终整数积分</span></header>
        <div className="m3-review-list">
          {pending.map((donation) => <article className="m3-review-card" key={donation.id}>
            <img src={donation.photoUrl} alt={`${donation.name}原图`} />
            <div className="review-info"><strong>{donation.name}</strong><small>{donation.donorName} · {donation.className} · {donation.donorNumber}</small><dl><div><dt>柜位</dt><dd>{donation.slotId}</dd></div><div><dt>类别/成色</dt><dd>{donation.categoryId} / {donation.condition}</dd></div><div><dt>规则建议</dt><dd>{donation.suggestedPoints} 分</dd></div><div><dt>模板</dt><dd>{donation.templateVersion}</dd></div></dl><p>{donation.description || '学生未填写补充说明'}</p></div>
            {donation.status === 'pending_review' ? <div className="review-controls"><label>最终整数积分<input type="number" min="1" max="10000" step="1" value={reviewPoints[donation.id] ?? String(donation.suggestedPoints)} onChange={(event) => setReviewPoints((current) => ({ ...current, [donation.id]: event.target.value }))} /></label><button className="real-action" type="button" disabled={busy} onClick={() => reviewDonation(donation, 'approve')}>审核通过并上架</button><label>退回原因<input value={returnReasons[donation.id] ?? ''} maxLength={200} onChange={(event) => setReturnReasons((current) => ({ ...current, [donation.id]: event.target.value }))} placeholder="实物核验不通过时填写" /></label><button className="secondary-action" type="button" disabled={busy} onClick={() => reviewDonation(donation, 'return')}>退回并保留占柜</button></div>
              : <div className="review-controls returned-controls"><p>退回原因：{donation.returnReason}</p><button className="real-action" type="button" disabled={busy} onClick={() => releaseReturned(donation)}>确认实物已移出并释放柜位</button></div>}
          </article>)}
          {pending.length === 0 && <p className="empty-state">当前没有待审核或待移出的物品。</p>}
        </div>
      </section>

      <div className="m2-workspace">
        <section className="student-admin"><header className="section-heading"><div><p className="section-kicker">真实数据库</p><h2>搜索学生与劳动加分</h2></div><span>显示姓名、班级、学号和余额</span></header><label className="search-field">姓名或学号<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入姓名或学号；留空显示全部" /></label><div className="real-student-list">{students.map((student) => <button className={selected?.id === student.id ? 'active' : ''} type="button" key={student.id} onClick={() => { setSelected(student); setRewardKey(crypto.randomUUID()); setMessage(''); }}><span><strong>{student.name}</strong><small>{student.className} · {student.studentId}</small></span><b>{student.balance} 分</b></button>)}{students.length === 0 && <p>暂无匹配学生。可先导入 CSV 名单。</p>}</div>{selected && <form className="reward-form" onSubmit={reward}><p>为 <strong>{selected.name}</strong> 发放劳动奖励</p><label>整数积分<input type="number" min="1" max="10000" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label>原因<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={2} maxLength={200} required placeholder="例如：整理循环站物品" /></label><button className="real-action" type="submit" disabled={busy}>确认发放</button><small>失败重试沿用同一请求标识；成功后新奖励使用新标识。</small></form>}</section>

        <aside className="teacher-side m2-side"><form className="csv-import" onSubmit={importCsv}><p className="section-kicker">真实操作 · 幂等导入</p><h2>导入学生名单</h2><p>CSV 表头：name, student_id, class_name。普通新学生首次获得 20 分；重复导入不重置余额。</p><label className="file-picker">选择 CSV<input type="file" accept=".csv,text/csv" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setCsv(await file.text()); setCsvName(file.name); }} /></label><small>{csvName || '尚未选择文件'}</small><button className="real-action" type="submit" disabled={busy || !csv}>导入名单</button></form>
          <section className="live-lockers"><p className="section-kicker">真实柜位概览</p><h2>当前存放内容</h2><div className="free-counts">{freeCounts.map(({ zone, count }) => <span key={zone}><b>{zone}</b>{count} 空闲</span>)}</div><div className="locker-content-list">{occupied.map((slot) => <div key={slot.id}><b>{slot.id}</b><span>{slot.donation?.name}<small>{slot.donation?.donorName ? `${slot.donation.donorName} · ` : ''}{slot.donation?.status}</small></span></div>)}{occupied.length === 0 && <p>当前柜位均为空闲。</p>}</div></section>
        </aside>
      </div>
      <section className="m4-admin-section">
        <header className="section-heading"><div><p className="section-kicker">M4 · 领取闭环</p><h2>最近领取与柜位异常</h2></div><span>异常仅人工处理，不自动退款或调分</span></header>
        <div className="m4-admin-grid">
          <div><h3>最近领取</h3>{redemptions.map((claim) => <article className="claim-row" key={claim.id}><img src={claim.photoUrl} alt={`${claim.itemName}领取原图`} /><span><strong>{claim.itemName}</strong><small>{claim.studentName} · {claim.studentNumber}</small><small>{claim.slotId} · {claim.pointsSpent} 分 · {new Date(claim.createdAt).toLocaleString('zh-CN')}</small></span></article>)}{redemptions.length === 0 && <p>暂无领取记录。</p>}</div>
          <div><h3>柜位异常</h3>{issues.map((issue) => <article className="issue-row" key={issue.id}><span><strong>{issue.slotId} · {issue.itemName}</strong><small>{issue.studentName} · {new Date(issue.createdAt).toLocaleString('zh-CN')}</small><p>{issue.description}</p></span>{issue.status === 'open' ? <button className="real-action" type="button" disabled={busy} onClick={() => resolveIssue(issue)}>标记已处理</button> : <b>已处理</b>}</article>)}{issues.length === 0 && <p>暂无柜位异常。</p>}</div>
        </div>
      </section>
    </div>
  );
}
