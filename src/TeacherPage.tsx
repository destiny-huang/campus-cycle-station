import { useEffect, useState, type FormEvent } from 'react';
import { api, postJson, type Session, type Student } from './api';
import { DEMO_REVIEWS, ZONE_CONFIGS } from './demo-data';

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
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const authenticated = session?.role === 'teacher';

  async function loadStudents(search = query) {
    const result = await api<{ students: Student[] }>(`/api/teacher/students?query=${encodeURIComponent(search)}`);
    setStudents(result.students);
    if (selected) setSelected(result.students.find((student) => student.id === selected.id) ?? selected);
  }

  useEffect(() => {
    if (!authenticated) { setStudents([]); setSelected(null); return; }
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
      setSelected(result.student); setAmount(''); setReason(''); setRewardKey(crypto.randomUUID());
      await loadStudents();
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  if (!authenticated) {
    return (
      <div className="teacher-page">
        <header className="teacher-heading"><div><p className="section-kicker">一个轻量教师端</p><h1>循环站管理</h1><p>教师口令仅从本地运行环境读取，不会写入页面或仓库。</p></div></header>
        <section className="teacher-login auth-panel">
          <div><p className="section-kicker">教师登录</p><h2>输入本地教师口令</h2><p>{session?.role === 'student' ? '当前是学生会话，登录教师端将切换会话。' : '未登录教师不能导入名单、搜索学生或发放积分。'}</p></div>
          <form onSubmit={teacherLogin}><label>教师口令<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label><button className="real-action" type="submit" disabled={busy}>{busy ? '登录中…' : '登录教师端'}</button></form>
        </section>
        {message && <p className="inline-notice" role="status">{message}</p>}
      </div>
    );
  }

  return (
    <div className="teacher-page">
      <header className="teacher-heading">
        <div><p className="section-kicker">教师端 · {session.mode === 'demo' ? '演示数据库' : '正式数据库'}</p><h1>循环站管理</h1><p>名单、余额和积分流水已接入后端；捐赠审核仍待 M3。</p></div>
        <button className="text-action" type="button" onClick={logout} disabled={busy}>退出教师端</button>
      </header>
      {message && <p className="inline-notice" role="status">{message}</p>}

      <div className="m2-workspace">
        <section className="student-admin">
          <header className="section-heading"><div><p className="section-kicker">真实数据库</p><h2>搜索学生与劳动加分</h2></div><span>显示姓名、班级、学号和余额</span></header>
          <label className="search-field">姓名或学号<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入姓名或学号；留空显示全部" /></label>
          <div className="real-student-list">
            {students.map((student) => <button className={selected?.id === student.id ? 'active' : ''} type="button" key={student.id} onClick={() => { setSelected(student); setRewardKey(crypto.randomUUID()); setMessage(''); }}><span><strong>{student.name}</strong><small>{student.className} · {student.studentId}</small></span><b>{student.balance} 分</b></button>)}
            {students.length === 0 && <p>暂无匹配学生。可先导入 CSV 名单。</p>}
          </div>
          {selected && <form className="reward-form" onSubmit={reward}><p>为 <strong>{selected.name}</strong> 发放劳动奖励</p><label>整数积分<input type="number" min="1" max="10000" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><label>原因<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={2} maxLength={200} required placeholder="例如：整理循环站物品" /></label><button className="real-action" type="submit" disabled={busy}>确认发放</button><small>失败重试沿用同一请求标识；成功后新奖励使用新标识。</small></form>}
        </section>

        <aside className="teacher-side m2-side">
          <form className="csv-import" onSubmit={importCsv}>
            <p className="section-kicker">真实操作 · 幂等导入</p><h2>导入学生名单</h2>
            <p>CSV 表头：name, student_id, class_name。普通新学生首次获得 20 分；重复导入不重复发分、不重置余额。</p>
            <label className="file-picker">选择 CSV<input type="file" accept=".csv,text/csv" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setCsv(await file.text()); setCsvName(file.name); }} /></label>
            <small>{csvName || '尚未选择文件'}</small><button className="real-action" type="submit" disabled={busy || !csv}>导入名单</button>
          </form>
          <section className="mini-cabinets"><p className="section-kicker">配置概览 · 非实时占用</p><h2>ABC 柜位</h2>{(Object.entries(ZONE_CONFIGS) as [string, (typeof ZONE_CONFIGS)[keyof typeof ZONE_CONFIGS]][]).map(([zone, config]) => <div className="mini-cabinet" key={zone}><b>{zone}</b><span>{config.label}</span><i /><small>{config.total} 格</small></div>)}</section>
        </aside>
      </div>

      <section className="pending-review"><header className="section-heading"><div><p className="section-kicker">M3 界面示例 · 非真实待办</p><h2>捐赠审核待开发</h2></div><span>{DEMO_REVIEWS.length} 条视觉示例</span></header></section>
    </div>
  );
}
