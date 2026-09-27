/**
 * 人情账 · 查还礼
 *
 * 需求里最核心的差异化功能。流程：
 *   搜对方 → 选对方要办的类型 → 看历史时间线 + 建议区间 + 依据 → 可以「按建议记一笔」
 *
 * 「模拟还礼」不写账：改类型就重算，随便试。
 */

import { useMemo, useState } from 'react';
import { formatCN, todayISO } from '@/domain/date';
import { formatCents } from '@/domain/money';
import { suggestGiftAmount } from '@/domain/suggest';
import { EVENT_TYPES } from '@/domain/types';
import type { Direction, EventType } from '@/domain/types';
import { useStore } from '@/store/useStore';
import type { Route } from '@/ui/router';
import { Avatar, EmptyState, Field, Segmented } from '@/ui/components/common';
import { SuggestCard } from '@/ui/components/SuggestCard';

export function SuggestPage({
  go,
  initialContactId,
}: {
  go: (r: Route) => void;
  initialContactId?: string;
}) {
  const ledger = useStore((s) => s.ledger);

  const [contactId, setContactId] = useState<string | null>(initialContactId ?? null);
  const [query, setQuery] = useState('');
  const [targetType, setTargetType] = useState<EventType>('结婚');
  const [direction, setDirection] = useState<Direction>('give');

  const contacts = useMemo(
    () => (ledger?.contacts ?? []).filter((c) => !c.deleted_at),
    [ledger],
  );

  /** 每个户头的往来规模，用于搜索结果排序（有往来的排前面） */
  const weightOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of ledger?.entries ?? []) {
      if (e.deleted_at) continue;
      m.set(e.contact_id, (m.get(e.contact_id) ?? 0) + Math.abs(e.amount_cents));
    }
    return m;
  }, [ledger]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      return contacts
        .slice()
        .sort((a, b) => (weightOf.get(b.id) ?? 0) - (weightOf.get(a.id) ?? 0))
        .slice(0, 12);
    }
    return contacts
      .filter((c) => {
        const hay = [
          c.display_name,
          c.legal_name ?? '',
          ...(c.aliases ?? []),
          c.clan_or_branch ?? '',
          c.notes ?? '',
        ]
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => (weightOf.get(b.id) ?? 0) - (weightOf.get(a.id) ?? 0))
      .slice(0, 30);
  }, [contacts, query, weightOf]);

  const contact = contacts.find((c) => c.id === contactId) ?? null;

  /** 该户头的时间线（含场次信息） */
  const history = useMemo(() => {
    if (!ledger || !contactId) return [];
    return ledger.entries
      .filter((e) => !e.deleted_at && e.contact_id === contactId)
      .map((e) => ({
        entry: e,
        event: ledger.events.find((ev) => ev.id === e.event_id) ?? null,
      }))
      .sort((a, b) => String(b.entry.happened_on).localeCompare(String(a.entry.happened_on)));
  }, [ledger, contactId]);

  /** 还礼建议 */
  const suggestion = useMemo(() => {
    if (!ledger || !contactId) return null;
    const entries = ledger.entries.filter((e) => e.contact_id === contactId);
    return suggestGiftAmount({
      entries,
      targetType,
      eventTypeOf: (eventId) => ledger.events.find((ev) => ev.id === eventId)?.type,
      direction,
      settings: ledger.settings,
      now: todayISO(),
    });
  }, [ledger, contactId, targetType, direction]);

  const totals = useMemo(() => {
    let give = 0;
    let receive = 0;
    for (const h of history) {
      if (h.entry.direction === 'give') give += h.entry.amount_cents;
      else receive += h.entry.amount_cents;
    }
    return { give, receive, net: receive - give };
  }, [history]);

  return (
    <>
      <div className="page-head">
        <h1>查还礼</h1>
        <p>对方要办事了，先看看以往跟他家的往来，心里有个数。这里只是参考，最终按当地风俗和长辈意见来。</p>
      </div>

      <div className="grid grid-2">
        {/* ---------------- 左：选人 ---------------- */}
        <div>
          <div className="card">
            <h3>1. 对方是谁</h3>
            <div className="search-bar">
              <span className="icon">🔍</span>
              <input
                className="input"
                type="text"
                value={query}
                placeholder="搜称呼、姓名、别名（如「三舅」）"
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            {contacts.length === 0 ? (
              <EmptyState icon="👥" title="还没有户头">
                先去「记一笔」建一个，或者到设置里载入示例账本看看效果。
              </EmptyState>
            ) : (
              <div className="list" style={{ maxHeight: 330, overflowY: 'auto' }}>
                {searchResults.map((c) => {
                  const w = weightOf.get(c.id) ?? 0;
                  return (
                    <button
                      key={c.id}
                      className="list-item"
                      style={
                        c.id === contactId
                          ? { background: 'var(--paper)', boxShadow: 'inset 3px 0 0 var(--ink)' }
                          : undefined
                      }
                      onClick={() => setContactId(c.id)}
                    >
                      <Avatar name={c.display_name} size={34} />
                      <div className="mid">
                        <div className="title" style={{ fontSize: '0.95em' }}>
                          {c.display_name}
                          <span className="tag">{c.relation}</span>
                          {c.archived ? <span className="tag archived">已归档</span> : null}
                        </div>
                        <div className="meta">
                          {(c.aliases ?? []).length > 0
                            ? `别名：${(c.aliases ?? []).join('、')}`
                            : c.clan_or_branch || '暂无别名'}
                        </div>
                      </div>
                      {w > 0 ? (
                        <div className="right">
                          <div className="sub">有往来</div>
                        </div>
                      ) : null}
                    </button>
                  );
                })}
                {searchResults.length === 0 ? (
                  <div className="empty" style={{ padding: '26px 16px' }}>
                    <div className="small">没找到「{query}」</div>
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <div className="card">
            <h3>2. 对方要办什么</h3>
            <Field label="场次类型">
              <div className="chips">
                {EVENT_TYPES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`chip${targetType === t ? ' on' : ''}`}
                    onClick={() => setTargetType(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="方向" hint="模拟一下：这次是你随出去，还是对方随给你">
              <Segmented<Direction>
                className="direction"
                value={direction}
                onChange={setDirection}
                options={[
                  { value: 'give', label: '我随出', dir: 'give' },
                  { value: 'receive', label: '对方随来', dir: 'receive' },
                ]}
              />
            </Field>

            <div className="hint">
              换个类型就重新算一遍，不会写进账本。这就是「模拟还礼」。
            </div>
          </div>
        </div>

        {/* ---------------- 右：建议 ---------------- */}
        <div>
          {!contact ? (
            <div className="card">
              <EmptyState icon="🧧" title="先选一个对方">
                左边搜一下名字，就能看到该还多少、以及这个数是怎么算出来的。
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="card">
                <div className="row-between" style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                    <Avatar name={contact.display_name} size={40} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '1.05em' }}>
                        {contact.display_name}
                      </div>
                      <div className="tiny muted">
                        {contact.relation}
                        {contact.clan_or_branch ? ` · ${contact.clan_or_branch}` : ''}
                      </div>
                    </div>
                  </div>
                  <button
                    className="btn sm"
                    onClick={() => go({ name: 'contact', id: contact.id })}
                  >
                    看户头页
                  </button>
                </div>

                <div className="grid grid-3" style={{ gap: 10 }}>
                  <div className="stat give" style={{ boxShadow: 'none' }}>
                    <div className="k">累计你随出</div>
                    <div className="v" style={{ fontSize: '1.25em' }}>
                      {formatCents(totals.give)}
                    </div>
                  </div>
                  <div className="stat receive" style={{ boxShadow: 'none' }}>
                    <div className="k">对方随来</div>
                    <div className="v" style={{ fontSize: '1.25em' }}>
                      {formatCents(totals.receive)}
                    </div>
                  </div>
                  <div className="stat" style={{ boxShadow: 'none' }}>
                    <div className="k">差额</div>
                    <div className="v" style={{ fontSize: '1.25em' }}>
                      {formatCents(Math.abs(totals.net))}
                    </div>
                    <div className="sub">
                      {totals.net === 0
                        ? '两边持平'
                        : totals.net > 0
                          ? '对方给的多'
                          : '你给的多'}
                    </div>
                  </div>
                </div>

                <div className="notice info" style={{ marginTop: 12 }}>
                  累计你随出 {formatCents(totals.give)}，对方随来 {formatCents(totals.receive)}
                  {totals.net === 0
                    ? '，两边持平。'
                    : totals.net > 0
                      ? `，目前对方多出 ${formatCents(totals.net)}。`
                      : `，目前你多出 ${formatCents(-totals.net)}。`}
                </div>
              </div>

              {suggestion ? (
                <div className="card">
                  <SuggestCard
                    suggestion={suggestion}
                    targetType={targetType}
                    direction={direction}
                  />
                  <div className="btn-row" style={{ marginTop: 14 }}>
                    <button
                      className="btn primary"
                      onClick={() => go({ name: 'quick-add' })}
                      disabled={suggestion.suggested_primary === null}
                      title={
                        suggestion.suggested_primary === null
                          ? '没有历史可参考，先手动记一笔'
                          : undefined
                      }
                    >
                      按建议记一笔
                    </button>
                    <button
                      className="btn"
                      onClick={() => go({ name: 'quick-add' })}
                    >
                      自己填金额
                    </button>
                  </div>
                </div>
              ) : null}

              {/* ---------------- 时间线 ---------------- */}
              <div className="card">
                <h3>往来时间线</h3>
                {history.length === 0 ? (
                  <div className="hint">这一户还没有往来记录。</div>
                ) : (
                  <div className="timeline">
                    {history.map(({ entry, event }) => (
                      <div
                        key={entry.id}
                        className={`timeline-item ${entry.direction}`}
                      >
                        <div className="timeline-head">
                          <strong className={entry.direction === 'give' ? 'amt-give' : 'amt-receive'}>
                            {entry.direction === 'give' ? '随出' : '收来'}{' '}
                            {formatCents(entry.amount_cents)}
                          </strong>
                          <span className="date">{formatCN(entry.happened_on)}</span>
                        </div>
                        <div className="timeline-body">
                          {event ? (
                            <>
                              {event.title}
                              <span className={`tag${event.type === '白事' ? ' sombre' : ''}`} style={{ marginLeft: 6 }}>
                                {event.type}
                              </span>
                            </>
                          ) : (
                            '（场次已删除）'
                          )}
                          {entry.gift_kind !== 'cash' && entry.goods_desc ? (
                            <> · 另带 {entry.goods_desc}</>
                          ) : null}
                          {entry.notes ? <> · {entry.notes}</> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
