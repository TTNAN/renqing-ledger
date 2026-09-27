/**
 * 人情账 · 首页
 *
 * 第一屏必须让长辈看懂三件事：
 *   1. 数据在哪（本机，不上传）
 *   2. 今年随出/收来/净支出
 *   3. 下一步点哪（记一笔 / 新建场次 / 查还礼）
 */

import { useMemo } from 'react';
import { currentYear, formatCN } from '@/domain/date';
import { formatCents } from '@/domain/money';
import { joinRows, rowsInYear, totalsOf } from '@/domain/stats';
import { backupTarget, thisDevice } from '@/platform';
import { useStore, isEmptyLedger } from '@/store/useStore';
import type { Route } from '@/ui/router';
import { Avatar, EmptyState, StatCard } from '@/ui/components/common';
import { LedgerNotReady } from '@/ui/components/LedgerNotReady';

export function HomePage({ go }: { go: (r: Route) => void }) {
  const ledger = useStore((s) => s.ledger);
  const loadSeed = useStore((s) => s.loadSeed);
  const toast = useStore((s) => s.toast);

  const year = currentYear();

  const { yearTotals, recentEvents, recentEntries, contactName } = useMemo(() => {
    if (!ledger) {
      return { yearTotals: null, recentEvents: [], recentEntries: [], contactName: () => '' };
    }
    const rows = joinRows(ledger.entries, ledger.events, ledger.contacts);
    const yRows = rowsInYear(rows, year);

    const evMap = new Map(ledger.contacts.map((c) => [c.id, c.display_name]));

    const recentEvents = ledger.events
      .filter((e) => !e.deleted_at)
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 5);

    const recentEntries = ledger.entries
      .filter((e) => !e.deleted_at)
      .slice()
      .sort((a, b) => {
        const c = String(b.happened_on).localeCompare(String(a.happened_on));
        return c !== 0 ? c : String(b.created_at).localeCompare(String(a.created_at));
      })
      .slice(0, 10);

    return {
      yearTotals: totalsOf(yRows),
      recentEvents,
      recentEntries,
      contactName: (id: string) => evMap.get(id) ?? '（未知）',
    };
  }, [ledger, year]);

  /* 账本没就绪（正常走不到，boot 会兜底成空账本） */
  if (!ledger) return <LedgerNotReady go={go} />;

  /* 首次使用：还没有任何往来记录 */
  if (isEmptyLedger(ledger)) {
    return (
      <>
        <div className="page-head">
          <h1>人情账</h1>
          <p>记录谁家办事我随了多少、谁来随过我多少。下次对方办事，一查就知道该回多少。</p>
        </div>

        <div className="card">
          <div className="notice ok" style={{ marginTop: 0 }}>
            <strong>数据只存在{thisDevice()}上。</strong>
            本应用不联网、不需要账号、不上传任何内容。可以随时导出备份文件，{backupTarget()}。
          </div>

          <EmptyState
            icon="📕"
            title="还没有记过账"
            action={
              <>
                <div className="btn-row" style={{ justifyContent: 'center' }}>
                  <button className="btn primary lg" onClick={() => go({ name: 'quick-add' })}>
                    记第一笔
                  </button>
                  <button
                    className="btn lg"
                    onClick={() => {
                      void loadSeed();
                    }}
                  >
                    载入示例账本
                  </button>
                </div>
                {/*
                  空状态也要给出「查还礼」和「新建场次」的入口。
                  用户刚打开软件时的第一件事未必是记账 ——
                  可能是想先建个场次，或者查查某人以前给过多少。
                  只放两个按钮会让人以为这软件只有记账功能。
                */}
                <div className="btn-row" style={{ justifyContent: 'center', marginTop: 10 }}>
                  <button className="btn ghost" onClick={() => go({ name: 'suggest' })}>
                    查还礼
                  </button>
                  <button className="btn ghost" onClick={() => go({ name: 'events' })}>
                    新建场次
                  </button>
                  <button className="btn ghost" onClick={() => go({ name: 'contacts' })}>
                    看户头
                  </button>
                </div>
              </>
            }
          >
            可以先载入一份示例账本（人名金额均为虚构）熟悉一下，也可以直接开始记自己的账。
          </EmptyState>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <h1>{ledger.household.name}的人情账</h1>
        <p>
          {year} 年 · 共 {ledger.events.filter((e) => !e.deleted_at).length} 场 ·{' '}
          {ledger.contacts.filter((c) => !c.deleted_at).length} 户人家
        </p>
      </div>

      {yearTotals ? (
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <StatCard
            label={`${year} 年随出`}
            value={formatCents(yearTotals.give)}
            sub={`${yearTotals.count} 笔往来`}
            tone="give"
          />
          <StatCard
            label={`${year} 年收来`}
            value={formatCents(yearTotals.receive)}
            tone="receive"
          />
          <StatCard
            label="净支出"
            value={formatCents(yearTotals.give - yearTotals.receive)}
            sub={yearTotals.give - yearTotals.receive >= 0 ? '随出多于收来' : '收来多于随出'}
          />
        </div>
      ) : null}

      <div className="card">
        <div className="btn-row">
          <button className="btn primary lg" onClick={() => go({ name: 'quick-add' })}>
            记一笔
          </button>
          <button className="btn lg" onClick={() => go({ name: 'events' })}>
            新建场次
          </button>
          <button className="btn lg" onClick={() => go({ name: 'suggest' })}>
            查还礼
          </button>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="card tight">
          <div style={{ padding: '15px 17px 11px' }} className="row-between">
            <h3 style={{ margin: 0 }}>最近场次</h3>
            <button className="btn ghost sm" onClick={() => go({ name: 'events' })}>
              全部
            </button>
          </div>
          {recentEvents.length === 0 ? (
            <div className="empty" style={{ padding: '26px 18px' }}>
              <div className="small">还没有场次</div>
            </div>
          ) : (
            <div className="list">
              {recentEvents.map((ev) => {
                const list = ledger.entries.filter(
                  (e) => !e.deleted_at && e.event_id === ev.id,
                );
                const t = totalsOf(
                  list.map((entry) => ({ entry, event: ev, contact: null })),
                );
                const net = t.receive - t.give;
                return (
                  <button
                    key={ev.id}
                    className="list-item"
                    onClick={() => go({ name: 'event', id: ev.id })}
                  >
                    <div className="mid">
                      <div className="title">
                        {ev.title}
                        <span className={`tag${ev.type === '白事' ? ' sombre' : ''}`}>
                          {ev.type}
                        </span>
                        {ev.host_side === 'self' ? (
                          <span className="tag self">我家办事</span>
                        ) : null}
                      </div>
                      <div className="meta">
                        {formatCN(ev.date)} · {list.length} 笔
                        {ev.location ? ` · ${ev.location}` : ''}
                      </div>
                    </div>
                    <div className="right">
                      <div
                        className={`big ${net >= 0 ? 'amt-receive' : 'amt-give'}`}
                      >
                        {net >= 0 ? '+' : '−'}
                        {formatCents(Math.abs(net), { symbol: false })}
                      </div>
                      <div className="sub">净额</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="card tight">
          <div style={{ padding: '15px 17px 11px' }} className="row-between">
            <h3 style={{ margin: 0 }}>最近条目</h3>
            <button className="btn ghost sm" onClick={() => go({ name: 'contacts' })}>
              按人看
            </button>
          </div>
          {recentEntries.length === 0 ? (
            <div className="empty" style={{ padding: '26px 18px' }}>
              <div className="small">还没有条目</div>
            </div>
          ) : (
            <div className="list">
              {recentEntries.map((en) => {
                const name = contactName(en.contact_id);
                const ev = ledger.events.find((e) => e.id === en.event_id);
                return (
                  <button
                    key={en.id}
                    className="list-item"
                    onClick={() => go({ name: 'contact', id: en.contact_id })}
                  >
                    <Avatar name={name} size={34} />
                    <div className="mid">
                      <div className="title" style={{ fontSize: '0.95em' }}>
                        {name}
                        <span className={`tag ${en.direction}`}>
                          {en.direction === 'give' ? '随出' : '收来'}
                        </span>
                      </div>
                      <div className="meta">
                        {formatCN(en.happened_on)} · {ev?.title ?? '（场次已删）'}
                      </div>
                    </div>
                    <div className="right">
                      <div
                        className={`big ${en.direction === 'give' ? 'amt-give' : 'amt-receive'}`}
                      >
                        {formatCents(en.amount_cents, { symbol: false })}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="row-between">
          <div>
            <strong>数据在{thisDevice()}上</strong>
            <div className="small muted" style={{ marginTop: 2 }}>
              建议每隔一段时间导出一次备份，{backupTarget()}。
            </div>
          </div>
          <button
            className="btn"
            onClick={() => {
              toast('导出入口在「设置」里');
              go({ name: 'settings' });
            }}
          >
            去备份
          </button>
        </div>
      </div>
    </>
  );
}
