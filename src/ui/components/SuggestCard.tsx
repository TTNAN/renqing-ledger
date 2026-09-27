/**
 * 人情账 · 还礼建议卡片
 *
 * 需求里反复强调：不能只给一个数字，必须说清依据。
 * 所以这个组件把 suggested_primary 放大，把 basis 逐条列出来，
 * 把 warnings 用醒目但不吓人的方式呈现。
 */

import { formatCents } from '@/domain/money';
import type { Suggestion } from '@/domain/suggest';

export function SuggestCard({
  suggestion,
  targetType,
  direction,
  compact = false,
}: {
  suggestion: Suggestion;
  targetType: string;
  direction: 'give' | 'receive';
  compact?: boolean;
}) {
  const { suggested_primary, suggested_min, suggested_max, basis, warnings, has_history } =
    suggestion;

  const rangeText =
    suggested_primary === null
      ? '—'
      : suggested_min === suggested_max
        ? formatCents(suggested_primary)
        : `${formatCents(suggested_min)} – ${formatCents(suggested_max)}`;

  return (
    <div className="suggest-box">
      <div className="suggest-label">
        若对方现在办「{targetType}」，{direction === 'give' ? '你随出' : '对方随来'}
      </div>

      <div className="suggest-main">{rangeText}</div>

      {has_history && suggested_primary !== null ? (
        <div className="small muted" style={{ marginTop: 3 }}>
          建议以 <strong className="mono-num">{formatCents(suggested_primary)}</strong> 为中心
        </div>
      ) : null}

      {basis.length > 0 && !compact ? (
        <>
          <div
            className="small"
            style={{ marginTop: 15, marginBottom: 5, fontWeight: 600, color: 'var(--text-2)' }}
          >
            这个数是怎么来的
          </div>
          <ul className="basis">
            {basis.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </>
      ) : null}

      {warnings.map((w, i) => (
        <div key={i} className="notice warn">
          {w}
        </div>
      ))}

      {!has_history ? (
        <div className="notice info">
          这一户还没有往来记录。可以按亲疏远近、当地礼金起步价来定，
          记下这一笔之后，下次系统就有参考了。
        </div>
      ) : null}
    </div>
  );
}
