import { useEffect, useState, type FormEvent } from 'react';
import { postJson, type Session } from './api';

export function HomePage({ session, refreshSession, navigate }: {
  session: Session | null;
  refreshSession: () => Promise<Session>;
  navigate: (path: 'student' | 'teacher') => void;
}) {
  const [name, setName] = useState('');
  const [studentId, setStudentId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session?.role === 'student') navigate('student');
    if (session?.role === 'teacher') navigate('teacher');
  }, [session?.role]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('');
    try {
      await postJson('/api/auth/student', { name, studentId });
      await refreshSession();
      navigate('student');
    } catch (error) { setMessage((error as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="welcome-page">
    <section className="welcome-hero">
      <div className="welcome-copy">
        <p className="section-kicker">分享闲置 · 循环使用</p>
        <h1>让旧物在校园里<br />继续发光</h1>
        <p>捐出暂时用不到的物品获得积分，也可以用积分领取需要的物品。赠与完成后无需归还。</p>
        <div className="welcome-sketch" aria-hidden="true"><span>📚</span><i>↻</i><b>木</b><em>🌿</em></div>
      </div>
      <form className="welcome-login" onSubmit={login}>
        <p className="paper-kicker">学生登录</p>
        <h2>欢迎回来，同学</h2>
        <label>姓名<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required /></label>
        <label>学号<input value={studentId} onChange={(event) => setStudentId(event.target.value)} autoComplete="username" required /></label>
        <button className="real-action" type="submit" disabled={busy}>{busy ? '登录中…' : '进入循环站'}</button>
        {message && <p className="welcome-error" role="alert">{message}</p>}
        <small>姓名须与学校已导入名单中的学号对应，无需学生密码。</small>
      </form>
    </section>
    <button className="teacher-entry" type="button" onClick={() => navigate('teacher')}>教师入口 →</button>
  </div>;
}
