/**
 * 人情账 · 金额输入
 *
 * 需求里点名要「录得快」：
 *   - 输入 800 / 800元 / 捌佰 / 一千二 / 三块五 都能认
 *   - 右边实时显示解析结果，认不出来就变红提示
 *   - 常用金额一点即填
 *   - 回车直接触发 onEnter（连续录入靠这个）
 */

import { useEffect, useRef, useState } from 'react';
import { centsToInput, formatCents, parseMoneyToCents } from '@/domain/money';

const QUICK = [100, 200, 300, 500, 600, 800, 1000, 2000];

export function MoneyInput({
  valueCents,
  onChange,
  onEnter,
  autoFocus = false,
  placeholder = '0',
  quickAmounts = QUICK,
}: {
  valueCents: number | null;
  onChange: (cents: number | null, raw: string) => void;
  onEnter?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  quickAmounts?: number[];
}) {
  const [raw, setRaw] = useState(() =>
    valueCents === null ? '' : centsToInput(valueCents),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // 外部清空（连续录入）时同步
  useEffect(() => {
    if (valueCents === null && raw !== '') setRaw('');
    // 只在外部主动清空时同步，不覆盖用户正在输的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valueCents]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const trimmed = raw.trim();
  const parsed = trimmed === '' ? null : parseMoneyToCents(trimmed);
  const invalid = trimmed !== '' && parsed === null;

  function handleChange(next: string) {
    setRaw(next);
    const t = next.trim();
    onChange(t === '' ? null : parseMoneyToCents(t), next);
  }

  return (
    <div>
      <input
        ref={inputRef}
        className="input amount"
        type="text"
        inputMode="decimal"
        /*
         * enterKeyHint 是移动端标准属性，把软键盘右下角那个键
         * 标成「完成」。数字键盘尤其需要 —— 默认那个键常常只是个
         * 不带文字的 ↵，用户不知道按了会怎样。
         * 桌面端忽略这个属性，无副作用。
         */
        enterKeyHint="done"
        value={raw}
        placeholder={placeholder}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter?.();
          }
        }}
        aria-label="金额"
        aria-invalid={invalid}
        style={invalid ? { borderColor: 'var(--danger)' } : undefined}
      />

      <div className="hint" style={{ minHeight: '1.2em' }}>
        {invalid ? (
          <span style={{ color: 'var(--danger)' }}>
            没看懂这个金额，可以直接写数字，比如 800
          </span>
        ) : parsed !== null ? (
          <span>
            记作 <strong className="mono-num">{formatCents(parsed)}</strong>
            {/[\u4e00-\u9fa5]/.test(trimmed) ? '（已识别中文写法）' : ''}
          </span>
        ) : (
          <span>可以写 800、800元、捌佰、一千二</span>
        )}
      </div>

      <div className="quick-amounts">
        {quickAmounts.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => handleChange(String(v))}
            title={`填入 ${v} 元`}
          >
            {v}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            handleChange('');
            inputRef.current?.focus();
          }}
        >
          清空
        </button>
      </div>
    </div>
  );
}
