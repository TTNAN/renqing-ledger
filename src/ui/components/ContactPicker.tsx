/**
 * 人情账 · 户头选择器
 *
 * 「记一笔」里最关键的一步。要求：
 *   - 边打字边过滤，别名也能命中（搜「三舅」能找到「张叔」）
 *   - 找不到就当场建一个，不用跳出去
 *   - 键盘上下 + 回车即可选定，手不离键盘
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Contact, Relation } from '@/domain/types';
import { RELATIONS } from '@/domain/types';
import { Avatar } from './common';

/** 户头匹配：称呼、姓名、别名、分支、备注 都能命中 */
export function matchContact(c: Contact, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    c.display_name,
    c.legal_name ?? '',
    ...(c.aliases ?? []),
    c.clan_or_branch ?? '',
    c.relation,
    c.notes ?? '',
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

export function ContactPicker({
  contacts,
  value,
  onChange,
  onCreate,
  autoFocus = false,
  excludeIds = [],
}: {
  contacts: Contact[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** 当场新建户头，返回新 id */
  onCreate: (name: string, relation?: Relation) => Contact;
  autoFocus?: boolean;
  excludeIds?: string[];
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => contacts.find((c) => c.id === value) ?? null,
    [contacts, value],
  );

  const pool = useMemo(
    () => contacts.filter((c) => !c.archived && !excludeIds.includes(c.id)),
    [contacts, excludeIds],
  );

  const filtered = useMemo(() => {
    const list = pool.filter((c) => matchContact(c, query));
    // 有往来记录的排前面（这里按名字近似，真正的排序在调用方）
    return list.slice(0, 40);
  }, [pool, query]);

  const exactExists = useMemo(
    () =>
      pool.some(
        (c) =>
          c.display_name === query.trim() ||
          c.legal_name === query.trim() ||
          (c.aliases ?? []).includes(query.trim()),
      ),
    [pool, query],
  );

  // 点外面收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  function pick(c: Contact) {
    onChange(c.id);
    setQuery('');
    setOpen(false);
  }

  function createNow() {
    const name = query.trim();
    if (!name) return;
    const c = onCreate(name);
    pick(c);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = filtered[highlight];
      if (open && c) {
        pick(c);
      } else if (query.trim() && !exactExists) {
        createNow();
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  /* 已选定：显示成一个可点击清除的胶囊 */
  if (selected) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 11,
          padding: '9px 12px',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--radius)',
          background: 'var(--card)',
        }}
      >
        <Avatar name={selected.display_name} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{selected.display_name}</div>
          <div className="tiny muted">
            {selected.relation}
            {selected.clan_or_branch ? ` · ${selected.clan_or_branch}` : ''}
            {(selected.aliases ?? []).length > 0
              ? ` · 别名 ${(selected.aliases ?? []).join('、')}`
              : ''}
          </div>
        </div>
        <button
          type="button"
          className="btn sm"
          onClick={() => {
            onChange(null);
            setQuery('');
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
        >
          换一个
        </button>
      </div>
    );
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        className="input"
        type="text"
        value={query}
        placeholder="打名字找，找不到就直接新建"
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="选择对方户头"
      />

      {open ? (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 40,
            background: 'var(--card)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius)',
            boxShadow: 'var(--shadow-lg)',
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {filtered.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className="list-item"
              style={{
                background: i === highlight ? 'var(--paper)' : undefined,
                padding: '9px 12px',
              }}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
            >
              <Avatar name={c.display_name} size={30} />
              <div className="mid">
                <div className="title" style={{ fontSize: '0.95em' }}>
                  {c.display_name}
                  <span className="tag">{c.relation}</span>
                </div>
                {(c.aliases ?? []).length > 0 ? (
                  <div className="meta">别名：{(c.aliases ?? []).join('、')}</div>
                ) : null}
              </div>
            </button>
          ))}

          {query.trim() && !exactExists ? (
            <button
              type="button"
              className="list-item"
              style={{
                background: i0(filtered.length, highlight),
                padding: '10px 12px',
                color: 'var(--ink)',
                fontWeight: 600,
              }}
              onMouseEnter={() => setHighlight(filtered.length)}
              onMouseDown={(e) => {
                e.preventDefault();
                createNow();
              }}
            >
              ＋ 新建户头「{query.trim()}」
            </button>
          ) : null}

          {filtered.length === 0 && !query.trim() ? (
            <div className="empty" style={{ padding: '22px 14px' }}>
              <div className="small muted">还没有户头，直接在上面打名字就能建一个</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function i0(len: number, highlight: number): string | undefined {
  return highlight === len ? 'var(--paper)' : undefined;
}

/** 关系选择片 */
export function RelationPicker({
  value,
  onChange,
}: {
  value: Relation;
  onChange: (r: Relation) => void;
}) {
  return (
    <div className="chips">
      {RELATIONS.map((r) => (
        <button
          key={r}
          type="button"
          className={`chip${value === r ? ' on' : ''}`}
          onClick={() => onChange(r)}
        >
          {r}
        </button>
      ))}
    </div>
  );
}
