import { useState, type FormEvent } from 'react';
import { postJson } from './api';

type Message = { role: 'user' | 'assistant'; content: string };

export function AiAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: '你好，我是循环小助手。我可以帮你找物品、看积分、查询捐赠进度，也可以告诉你什么东西适合捐赠。' }]);
  const [draft, setDraft] = useState(''); const [busy, setBusy] = useState(false);
  async function send(event: FormEvent) {
    event.preventDefault(); const text = draft.trim(); if (!text || busy) return;
    const history = messages.slice(-16); setMessages((current) => [...current, { role: 'user', content: text }]); setDraft(''); setBusy(true);
    try {
      const result = await postJson<{ reply: string }>('/api/student/assistant', { message: text, history });
      setMessages((current) => [...current, { role: 'assistant', content: result.reply }]);
    } catch (error) {
      const message = error instanceof Error && /额度/.test(error.message) ? error.message : '循环小助手暂时休息一下，请稍后再试。';
      setMessages((current) => [...current, { role: 'assistant', content: message }]);
    } finally { setBusy(false); }
  }
  return <aside className={`ai-assistant ${open ? 'open' : ''}`}>
    {open && <div className="assistant-panel" role="dialog" aria-label="循环小助手">
      <header><strong>♻️ 循环小助手</strong><button type="button" onClick={() => setOpen(false)} aria-label="关闭">×</button></header>
      <div className="assistant-messages">{messages.map((item, index) => <p className={item.role} key={index}>{item.content}</p>)}{busy && <p className="assistant">正在查找真实数据…</p>}</div>
      <form onSubmit={send}><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1000} placeholder="问问积分、物品或捐赠进度" /><button type="submit" disabled={busy || !draft.trim()}>发送</button></form>
      <small>助手仅查询，不会替你领取、捐赠或修改积分。</small>
    </div>}
    <button className="assistant-trigger" type="button" onClick={() => setOpen((value) => !value)}>♻️ 循环小助手</button>
  </aside>;
}
