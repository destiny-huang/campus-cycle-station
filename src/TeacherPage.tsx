import { useState } from 'react';
import { DEMO_REVIEWS, DEMO_STUDENTS, ZONE_CONFIGS } from './demo-data';

export function TeacherPage() {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const students = normalized
    ? DEMO_STUDENTS.filter((student) => `${student.name}${student.studentId}`.toLowerCase().includes(normalized))
    : DEMO_STUDENTS;

  return (
    <div className="teacher-page">
      <header className="teacher-heading">
        <div><p className="section-kicker">教师端 · 界面演示</p><h1>循环站管理</h1><p>审核、名单与积分操作尚未接入后端。</p></div>
        <div className="teacher-summary">
          <span><small>示例待审核</small><strong>{DEMO_REVIEWS.length}</strong></span>
          <span><small>示例学生</small><strong>{DEMO_STUDENTS.length}</strong></span>
          <span><small>真实业务数据</small><strong>—</strong></span>
        </div>
      </header>

      <div className="teacher-workspace">
        <section className="review-section">
          <header className="section-heading"><div><p className="section-kicker">只读演示列表</p><h2>待审核物品</h2></div><span>共 {DEMO_REVIEWS.length} 条示例</span></header>
          <div className="review-list">
            {DEMO_REVIEWS.map((review) => (
              <article className="review-row" key={review.id}>
                <span className="review-thumb" aria-hidden="true">物</span>
                <div className="review-main"><strong>{review.item}</strong><small>{review.student} · {review.className}</small></div>
                <dl><div><dt>柜位</dt><dd>{review.slot}</dd></div><div><dt>建议分</dt><dd>{review.suggestion}</dd></div><div><dt>最终分</dt><dd>—</dd></div></dl>
                <button type="button" disabled>审核待开发</button>
              </article>
            ))}
          </div>
        </section>

        <aside className="teacher-side">
          <section className="student-search">
            <p className="section-kicker">演示搜索 · 不连接真实名单</p>
            <h2>学生与劳动加分</h2>
            <label htmlFor="student-query">姓名或学号</label>
            <input id="student-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入示例姓名或 DEMO 学号" />
            <div className="student-results">
              {students.map((student) => <div key={student.studentId}><span><strong>{student.name}</strong><small>{student.className} · {student.studentId}</small></span><button type="button" disabled>加分待开发</button></div>)}
              {students.length === 0 && <p>没有匹配的演示学生</p>}
            </div>
          </section>
          <section className="mini-cabinets">
            <p className="section-kicker">配置概览 · 非实时占用</p><h2>ABC 柜位</h2>
            {(Object.entries(ZONE_CONFIGS) as [string, (typeof ZONE_CONFIGS)[keyof typeof ZONE_CONFIGS]][]).map(([zone, config]) => (
              <div className="mini-cabinet" key={zone}><b>{zone}</b><span>{config.label}</span><i /><small>{config.total} 格</small></div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
