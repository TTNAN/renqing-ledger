/**
 * 人情账 · 统计
 *
 * 过年整理一年的随礼支出，看这里。
 * 用 Recharts 画月度柱状图：随出与收来双色，跟全局配色一致。
 */

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { currentYear } from '@/domain/date';
import { centsToYuan, formatCents } from '@/domain/money';
import {
  byEventType,
  byMonth,
  byRelation,
  joinRows,
  rowsInYear,
  totalsOf,
  yearsInLedger,
} from '@/domain/stats';
import { useStore } from '@/store/useStore';
import type { Route } from '@/ui/router';
import { EmptyState, StatCard } from '@/ui/components/common';
import { LedgerNotReady } from '@/ui/components/LedgerNotReady';

export function StatsPage({ go }: { go: (r: Route) => void }) {
  const ledger = useStore((s) => s.ledger);
  const [year, setYear] = useState(currentYear());

  const years = useMemo(
    () => yearsInLedger(ledger?.entries ?? [], currentYear()),
    [ledger],
  );

  const { totals, months, types, relations, allTime } = useMemo(() => {
    if (!ledger) {
      return { totals: null, months: [], types: [], relations: [], allTime: null };
    }
    const rows = joinRows(ledger.entries, ledger.events, ledger.contacts);
    const yRows = rowsInYear(rows, year);
    return {
      totals: totalsOf(yRows),
      months: byMonth(rows, year),
      types: byEventType(yRows),
      relations: byRelation(yRows),
      allTime: totalsOf(rows),
    };
  }, [ledger, year]);

  const chartData = useMemo(
    () =>
      months.map((m) => ({
        name: m.label,
        随出: centsToYuan(m.give),
        收来: centsToYuan(m.receive),
      })),
    [months],
  );

  if (!ledger) return <LedgerNotReady go={go} />;

  const hasAny = (ledger.entries ?? []).some((e) => !e.deleted_at);

  if (!hasAny) {
    return (
      <>
        <div className="page-head">
          <h1>统计</h1>
        </div>
        <div className="card">
          <EmptyState
            icon="📊"
            title="还没有数据"
            action={
              <button className="btn primary" onClick={() => go({ name: 'quick-add' })}>
                去记一笔
              </button>
            }
          >
            记满几笔之后，这里会显示年度收支、按类型和关系的汇总，还有月度柱状图。
          </EmptyState>
        </div>
      </>
    );
  }

  const maxType = Math.max(
    1,
    ...types.map((t) => Math.max(t.totals.give, t.totals.receive)),
  );
  const maxRel = Math.max(1, ...relations.map((r) => Math.max(r.totals.give, r.totals.receive)));

  return (
    <>
      <div className="page-head row-between">
        <div>
          <h1>统计</h1>
          <p>
            全部年份累计：随出 {formatCents(allTime?.give ?? 0)}，收来{' '}
            {formatCents(allTime?.receive ?? 0)}
          </p>
        </div>
        <select
          className="select"
          style={{ width: 'auto' }}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y} 年
            </option>
          ))}
        </select>
      </div>

      {totals ? (
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <StatCard
            label={`${year} 年随出`}
            value={formatCents(totals.give)}
            sub={`${totals.count} 笔`}
            tone="give"
          />
          <StatCard label={`${year} 年收来`} value={formatCents(totals.receive)} tone="receive" />
          <StatCard
            label="净支出"
            value={formatCents(totals.give - totals.receive)}
            sub={totals.give - totals.receive >= 0 ? '这一年花出去的' : '这一年收回来的'}
          />
        </div>
      ) : null}

      <div className="card">
        <h3>{year} 年按月</h3>
        <div className="chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e2da" vertical={false} />
              <XAxis dataKey="name" tickLine={false} axisLine={{ stroke: '#d3cfc4' }} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={54}
                tickFormatter={(v: number) => (v >= 10000 ? `${v / 10000}万` : String(v))}
              />
              <Tooltip
                formatter={(v: number) => [`¥${v.toLocaleString('zh-CN')}`, '']}
                contentStyle={{
                  borderRadius: 8,
                  border: '1px solid #e5e2da',
                  fontSize: 13,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 13 }} />
              <Bar dataKey="随出" fill="#2f6b57" radius={[3, 3, 0, 0]} />
              <Bar dataKey="收来" fill="#b23a2e" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="hint">纵轴单位：元。悬停柱子可以看到具体金额。</div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>按类型</h3>
          {types.length === 0 ? (
            <div className="hint">{year} 年还没有记录。</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th style={{ textAlign: 'right' }}>随出</th>
                    <th style={{ textAlign: 'right' }}>收来</th>
                    <th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.type}>
                      <td>
                        <span className={`tag${t.type === '白事' ? ' sombre' : ''}`}>
                          {t.type}
                        </span>
                      </td>
                      <td className="num amt-give">
                        {t.totals.give > 0 ? formatCents(t.totals.give) : '—'}
                      </td>
                      <td className="num amt-receive">
                        {t.totals.receive > 0 ? formatCents(t.totals.receive) : '—'}
                      </td>
                      <td>
                        <div
                          style={{
                            height: 7,
                            borderRadius: 4,
                            background: '#2f6b57',
                            width: `${(t.totals.give / maxType) * 100}%`,
                            marginBottom: 3,
                          }}
                        />
                        <div
                          style={{
                            height: 7,
                            borderRadius: 4,
                            background: '#b23a2e',
                            width: `${(t.totals.receive / maxType) * 100}%`,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h3>按关系</h3>
          {relations.length === 0 ? (
            <div className="hint">{year} 年还没有记录。</div>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>关系</th>
                    <th style={{ textAlign: 'right' }}>随出</th>
                    <th style={{ textAlign: 'right' }}>收来</th>
                    <th style={{ width: 120 }} />
                  </tr>
                </thead>
                <tbody>
                  {relations.map((r) => (
                    <tr key={r.relation}>
                      <td>
                        <span className="tag">{r.relation}</span>
                      </td>
                      <td className="num amt-give">
                        {r.totals.give > 0 ? formatCents(r.totals.give) : '—'}
                      </td>
                      <td className="num amt-receive">
                        {r.totals.receive > 0 ? formatCents(r.totals.receive) : '—'}
                      </td>
                      <td>
                        <div
                          style={{
                            height: 7,
                            borderRadius: 4,
                            background: '#2f6b57',
                            width: `${(r.totals.give / maxRel) * 100}%`,
                            marginBottom: 3,
                          }}
                        />
                        <div
                          style={{
                            height: 7,
                            borderRadius: 4,
                            background: '#b23a2e',
                            width: `${(r.totals.receive / maxRel) * 100}%`,
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
