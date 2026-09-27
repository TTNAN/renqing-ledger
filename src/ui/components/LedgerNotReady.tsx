/**
 * 人情账 · 账本未就绪的兜底页
 *
 * 为什么需要它：
 *   所有页面都从 store 拿 ledger。boot() 之后它一定存在（空账本也兜底），
 *   所以这个分支正常走不到 —— 它只是类型收窄 + 极端情况的保险。
 *
 *   但**绝不能 return null**。曾经「记一笔」就是这么写的，
 *   结果首次打开时点进去是一片空白，用户完全不知道发生了什么。
 *   任何「什么都不显示」的路径，对用户来说都等于「这软件坏了」。
 */

import type { Route } from '@/ui/router';

export function LedgerNotReady({
  go,
  hint,
}: {
  go: (r: Route) => void;
  hint?: string;
}) {
  return (
    <div className="card">
      <div className="empty">
        <div className="icon">⏳</div>
        <h3>账本还没准备好</h3>
        <p>
          {hint ??
            '本机账本正在加载，或者读取时出了点问题。回首页重试一下，或者到设置里从备份恢复。'}
        </p>
        <div className="btn-row" style={{ justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => go({ name: 'home' })}>
            回到首页
          </button>
          <button className="btn" onClick={() => go({ name: 'settings' })}>
            去设置
          </button>
        </div>
      </div>
    </div>
  );
}
