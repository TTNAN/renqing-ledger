/**
 * 人情账 · 通用组件
 *
 * 都是无状态的小积木，不含业务逻辑。
 */

import { useEffect, type ReactNode } from 'react';
import type { ToastMessage } from '@/store/useStore';

/* ------------------------------------------------------------------ 提示条 */

export function Toasts({
  items,
  onDismiss,
}: {
  items: ToastMessage[];
  onDismiss: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="toasts">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`} onClick={() => onDismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 弹窗 */

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
}) {
  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-mask"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** 二次确认。删除类操作一律走这里。 */
export function ConfirmModal({
  title = '确认一下',
  message,
  confirmText = '确定',
  danger = false,
  onConfirm,
  onCancel,
}: {
  title?: string;
  message: ReactNode;
  confirmText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button className="btn" onClick={onCancel}>
            取消
          </button>
          <button
            className={`btn ${danger ? 'danger' : 'primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </>
      }
    >
      <div style={{ lineHeight: 1.75 }}>{message}</div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 数字卡 */

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'give' | 'receive';
}) {
  return (
    <div className={`stat${tone ? ` ${tone}` : ''}`}>
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {sub ? <div className="sub">{sub}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 空状态 */

export function EmptyState({
  icon = '📖',
  title,
  children,
  action,
}: {
  icon?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ 分段选择 */

export interface SegOption<T extends string> {
  value: T;
  label: string;
  /** 用于方向选择器着色 */
  dir?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = '',
}: {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={value === o.value ? 'on' : ''}
          data-dir={o.dir}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 字段 */

export function Field({
  label,
  hint,
  hintWarn = false,
  children,
}: {
  label: string;
  hint?: ReactNode;
  hintWarn?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className={`hint${hintWarn ? ' warn' : ''}`}>{hint}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 头像 */

const AVATAR_COLORS = [
  '#2f6b57',
  '#2b3f5c',
  '#7a5c3a',
  '#5b4a6b',
  '#3a6b6b',
  '#6b4a3a',
  '#4a5b3a',
  '#5c3a4a',
];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  const ch = (name || '?').trim().charAt(0) || '?';
  return (
    <div
      className="avatar"
      style={{
        background: avatarColor(name),
        width: size,
        height: size,
        fontSize: size * 0.4,
        /*
         * 行高必须显式设成与容器等高。
         * 只靠 flex 居中时，不同字号下中文字符的基线位置仍有细微差异，
         * 视觉上会显得「字偏了」—— 之前详情页的方形头像就是这个观感。
         */
        lineHeight: `${size}px`,
      }}
      aria-hidden
    >
      {ch}
    </div>
  );
}
