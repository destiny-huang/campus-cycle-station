import { useEffect, useRef, useState } from 'react';

const steps = [
  { title: '欢迎来到校园循环站', art: '🌿  📚  ↻', body: <>把暂时用不到的物品分享出来，让它们在校园里继续发挥作用。<strong>捐赠获得积分，领取使用积分。</strong></> },
  { title: '如何捐赠', art: '📷  →  📝  →  🗄️', body: <>上传照片，填写名称、类别、尺寸区和物品状态，系统会自动分配 A / B / C 柜位。<strong>一次提交一件，完成后可以继续捐赠。</strong></> },
  { title: '积分如何确认', art: '📖  10分  ✓', body: <>系统会根据物品类别和状态给出积分建议，教师检查实物后确认最终积分。<strong>例如状态良好的课外书，标准积分和规则建议均可为 10 分。</strong></> },
  { title: '如何领取', art: '🗄️  →  🎁  →  📍', body: <>浏览柜墙、查看所需积分并确认领取，积分自动扣除，然后前往指定柜位取走物品。<strong>这是赠与系统，领取成功后无需归还。</strong></> },
  { title: '你已经了解校园循环站啦！', art: '🌱  循  🌱', body: <>现在可以捐赠一件闲置物品，或去柜墙看看有什么正需要新主人。<strong>所有教程示例都是教学演示，不会改变积分或柜位。</strong></> },
];

export function OnboardingTutorial({ onComplete, onSkip }: { onComplete: () => Promise<void>; onSkip: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, [step]);

  async function finish(skip: boolean) {
    setBusy(true);
    try { await (skip ? onSkip() : onComplete()); }
    finally { setBusy(false); }
  }

  return <div className="tutorial-backdrop" role="presentation">
    <section className="tutorial-panel" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <header><span>{step + 1} / {steps.length}</span><button type="button" disabled={busy} onClick={() => finish(true)}>跳过教程</button></header>
      <div className="tutorial-progress" aria-hidden="true"><i style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
      <div className="tutorial-content" key={step}>
        <div className={`tutorial-art tutorial-art-${step + 1}`} aria-hidden="true">{steps[step].art}</div>
        <p className="paper-kicker">教学演示状态</p>
        <h2 id="tutorial-title" ref={titleRef} tabIndex={-1}>{steps[step].title}</h2>
        <div className="tutorial-copy">{steps[step].body}</div>
      </div>
      <footer>
        <button type="button" disabled={step === 0 || busy} onClick={() => setStep((value) => value - 1)}>上一步</button>
        {step < steps.length - 1
          ? <button className="real-action" type="button" disabled={busy} onClick={() => setStep((value) => value + 1)}>下一步</button>
          : <button className="real-action" type="button" disabled={busy} onClick={() => finish(false)}>{busy ? '保存中…' : '开始使用'}</button>}
      </footer>
    </section>
  </div>;
}
