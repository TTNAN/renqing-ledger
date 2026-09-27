/**
 * 人情账 · 导出（礼簿 / CSV / 文本）
 *
 * 全部是纯函数：给它数据，还你一段字符串。
 * 真正的下载动作在 repo.ts 的 downloadText。
 */

import { formatCN } from '@/domain/date';
import { formatCents } from '@/domain/money';
import type { Contact, Entry, Event, GiftKind } from '@/domain/types';
import { DIRECTION_LABEL, GIFT_KIND_LABEL } from '@/domain/types';

/* ------------------------------------------------------------------ 礼簿 */

export interface LedgerSheetRow {
  index: number;
  name: string;
  amount: number;
  amountText: string;
  note: string;
  method: string;
  handler: string;
}

export interface LedgerSheet {
  title: string;
  type: string;
  dateText: string;
  location: string;
  rows: LedgerSheetRow[];
  totalCents: number;
  totalText: string;
  count: number;
  household: string;
}

/**
 * 生成一场的礼簿。
 * 「我家办事」时按收来排序（礼簿要按金额或顺序看），
 * 「对方办事」时按随出。
 */
export function buildLedgerSheet(
  event: Event,
  entries: readonly Entry[],
  contacts: readonly Contact[],
  householdName: string,
): LedgerSheet {
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  const alive = entries
    .filter((e) => !e.deleted_at && e.event_id === event.id)
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  const rows: LedgerSheetRow[] = alive.map((e, i) => {
    const c = contactMap.get(e.contact_id);
    const parts: string[] = [];
    if (e.gift_kind !== 'cash' && e.goods_desc) parts.push(e.goods_desc);
    if (e.notes) parts.push(e.notes);
    return {
      index: i + 1,
      name: c?.display_name ?? '（已删除的户头）',
      amount: e.amount_cents,
      amountText: e.amount_cents > 0 ? formatCents(e.amount_cents, { symbol: false }) : '—',
      note: parts.join('；'),
      method: e.method ?? '',
      handler: e.handler ?? '',
    };
  });

  const totalCents = alive.reduce((acc, e) => acc + Math.max(0, e.amount_cents || 0), 0);

  return {
    title: event.title,
    type: event.type,
    dateText: formatCN(event.date),
    location: event.location ?? '',
    rows,
    totalCents,
    totalText: formatCents(totalCents),
    count: rows.length,
    household: householdName,
  };
}

/** 礼簿转纯文本，便于复制到微信发给家人 */
export function ledgerSheetToText(sheet: LedgerSheet): string {
  const lines: string[] = [];
  lines.push(`【${sheet.title}】礼簿`);
  lines.push(`${sheet.type} · ${sheet.dateText}${sheet.location ? ` · ${sheet.location}` : ''}`);
  lines.push('———————————');
  for (const r of sheet.rows) {
    lines.push(
      `${r.index}. ${r.name}  ${r.amountText}${r.note ? `  （${r.note}）` : ''}`,
    );
  }
  lines.push('———————————');
  lines.push(`共 ${sheet.count} 笔，合计 ${sheet.totalText}`);
  lines.push(`记账人：${sheet.household}`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ CSV */

/** CSV 单元格转义 */
function csvCell(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * 生成 CSV 文本。
 * 带 UTF-8 BOM，Excel 双击直接正确显示中文（不加 BOM 会乱码）。
 */
export function toCSV(headers: string[], rows: (string | number)[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return '\uFEFF' + lines.join('\r\n');
}

export const ENTRY_CSV_HEADERS = [
  '日期',
  '场次',
  '类型',
  '方向',
  '对方',
  '关系',
  '金额(元)',
  '形态',
  '礼物',
  '估价(元)',
  '方式',
  '经手人',
  '备注',
];

/** 条目列表 → CSV 行 */
export function entriesToCSV(
  entries: readonly Entry[],
  events: readonly Event[],
  contacts: readonly Contact[],
): string {
  const eventMap = new Map(events.map((e) => [e.id, e]));
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  const alive = entries
    .filter((e) => !e.deleted_at)
    .slice()
    .sort((a, b) => String(b.happened_on).localeCompare(String(a.happened_on)));

  const rows = alive.map((e) => {
    const ev = eventMap.get(e.event_id);
    const c = contactMap.get(e.contact_id);
    return [
      e.happened_on,
      ev?.title ?? '',
      ev?.type ?? '',
      DIRECTION_LABEL[e.direction],
      c?.display_name ?? '',
      c?.relation ?? '',
      (Math.max(0, e.amount_cents || 0) / 100).toFixed(2),
      GIFT_KIND_LABEL[e.gift_kind as GiftKind] ?? '',
      e.goods_desc ?? '',
      e.goods_value_cents ? (e.goods_value_cents / 100).toFixed(2) : '',
      e.method ?? '',
      e.handler ?? '',
      e.notes ?? '',
    ];
  });

  return toCSV(ENTRY_CSV_HEADERS, rows);
}

/** 户头往来汇总 → CSV */
export function contactsToCSV(
  rows: { contact: Contact; give: number; receive: number; net: number; count: number }[],
): string {
  const headers = ['称呼', '姓名', '别名', '关系', '家庭/分支', '电话', '累计随出(元)', '累计收来(元)', '净额(元)', '笔数', '备注'];
  const body = rows.map((r) => [
    r.contact.display_name,
    r.contact.legal_name ?? '',
    (r.contact.aliases ?? []).join(' / '),
    r.contact.relation,
    r.contact.clan_or_branch ?? '',
    r.contact.phone ?? '',
    (r.give / 100).toFixed(2),
    (r.receive / 100).toFixed(2),
    (r.net / 100).toFixed(2),
    r.count,
    r.contact.notes ?? '',
  ]);
  return toCSV(headers, body);
}

/* ------------------------------------------------------------------ 文件名 */

/** 生成安全的文件名：去掉 Windows/macOS 不允许的字符 */
export function safeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function backupFileName(household: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  return safeFileName(`人情账-${household}-${stamp}.json`);
}
