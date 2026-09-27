/**
 * 人情账 · 统计
 *
 * 全部是纯函数：传进数组，算出数字，不改任何东西。
 * 已删除的条目和场次默认排除。
 */

import { inYear, monthOf } from './date';
import type { Contact, Entry, Event, EventType, Relation } from './types';

/** 条目 + 它的场次 + 它的户头，拼好的一行 */
export interface EntryRow {
  entry: Entry;
  event: Event | null;
  contact: Contact | null;
}

export interface JoinOptions {
  /** 是否包含已软删除的记录，默认 false */
  includeDeleted?: boolean;
}

/** 把三个集合拼成便于统计的行 */
export function joinRows(
  entries: readonly Entry[],
  events: readonly Event[],
  contacts: readonly Contact[],
  opts: JoinOptions = {},
): EntryRow[] {
  const { includeDeleted = false } = opts;
  const eventMap = new Map(events.map((e) => [e.id, e]));
  const contactMap = new Map(contacts.map((c) => [c.id, c]));

  return entries
    .filter((e) => includeDeleted || !e.deleted_at)
    .map((entry) => {
      const event = eventMap.get(entry.event_id) ?? null;
      const contact = contactMap.get(entry.contact_id) ?? null;
      return { entry, event, contact };
    })
    .filter((r) => includeDeleted || !r.event?.deleted_at);
}

/** 求和：随出、收来、净额（收来 − 随出） */
export interface Totals {
  give: number;
  receive: number;
  /** 收来 − 随出。正数表示这段时间收得多 */
  net: number;
  count: number;
}

export function totalsOf(rows: readonly EntryRow[]): Totals {
  let give = 0;
  let receive = 0;
  for (const r of rows) {
    const c = Math.max(0, Math.round(r.entry.amount_cents || 0));
    if (r.entry.direction === 'give') give += c;
    else receive += c;
  }
  return { give, receive, net: receive - give, count: rows.length };
}

/** 只统计某一年 */
export function rowsInYear(rows: readonly EntryRow[], year: number): EntryRow[] {
  return rows.filter((r) => inYear(r.entry.happened_on, year));
}

/** 全库里出现过的年份，倒序 */
export function yearsInLedger(entries: readonly Entry[], fallbackYear: number): number[] {
  const set = new Set<number>();
  for (const e of entries) {
    if (e.deleted_at) continue;
    const y = Number(String(e.happened_on).slice(0, 4));
    if (Number.isFinite(y) && y > 1900) set.add(y);
  }
  set.add(fallbackYear);
  return [...set].sort((a, b) => b - a);
}

/* ------------------------------------------------------------------ 分组 */

export interface TypeBucket {
  type: EventType;
  totals: Totals;
}

/** 按场次类型汇总 */
export function byEventType(rows: readonly EntryRow[]): TypeBucket[] {
  const map = new Map<EventType, EntryRow[]>();
  for (const r of rows) {
    const t = (r.event?.type ?? '其他') as EventType;
    const arr = map.get(t);
    if (arr) arr.push(r);
    else map.set(t, [r]);
  }
  return [...map.entries()]
    .map(([type, rs]) => ({ type, totals: totalsOf(rs) }))
    .sort((a, b) => b.totals.give + b.totals.receive - (a.totals.give + a.totals.receive));
}

export interface RelationBucket {
  relation: Relation;
  totals: Totals;
}

/** 按关系汇总 */
export function byRelation(rows: readonly EntryRow[]): RelationBucket[] {
  const map = new Map<Relation, EntryRow[]>();
  for (const r of rows) {
    const rel = (r.contact?.relation ?? '其他') as Relation;
    const arr = map.get(rel);
    if (arr) arr.push(r);
    else map.set(rel, [r]);
  }
  return [...map.entries()]
    .map(([relation, rs]) => ({ relation, totals: totalsOf(rs) }))
    .sort((a, b) => b.totals.give - a.totals.give);
}

export interface MonthBucket {
  /** 1–12 */
  month: number;
  label: string;
  give: number;
  receive: number;
}

/** 按月汇总（1–12 月，缺月补零，方便直接喂给柱状图） */
export function byMonth(rows: readonly EntryRow[], year: number): MonthBucket[] {
  const buckets: MonthBucket[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: `${i + 1}月`,
    give: 0,
    receive: 0,
  }));

  for (const r of rows) {
    const iso = r.entry.happened_on;
    if (Number(String(iso).slice(0, 4)) !== year) continue;
    const m = monthOf(iso);
    if (m < 1 || m > 12) continue;
    const b = buckets[m - 1]!;
    const c = Math.max(0, Math.round(r.entry.amount_cents || 0));
    if (r.entry.direction === 'give') b.give += c;
    else b.receive += c;
  }

  return buckets;
}

/* ------------------------------------------------------------------ 户头维度 */

export interface ContactSummary {
  contact: Contact;
  give: number;
  receive: number;
  /** 收来 − 随出 */
  net: number;
  count: number;
  lastDate: string | null;
}

/** 每个户头的往来摘要，按往来规模倒序 */
export function summarizeContacts(
  entries: readonly Entry[],
  contacts: readonly Contact[],
): ContactSummary[] {
  const byContact = new Map<string, Entry[]>();
  for (const e of entries) {
    if (e.deleted_at) continue;
    const arr = byContact.get(e.contact_id);
    if (arr) arr.push(e);
    else byContact.set(e.contact_id, [e]);
  }

  const out: ContactSummary[] = [];
  for (const contact of contacts) {
    if (contact.deleted_at) continue;
    const list = byContact.get(contact.id) ?? [];
    let give = 0;
    let receive = 0;
    let lastDate: string | null = null;
    for (const e of list) {
      const c = Math.max(0, Math.round(e.amount_cents || 0));
      if (e.direction === 'give') give += c;
      else receive += c;
      if (!lastDate || e.happened_on > lastDate) lastDate = e.happened_on;
    }
    out.push({
      contact,
      give,
      receive,
      net: receive - give,
      count: list.length,
      lastDate,
    });
  }

  return out.sort((a, b) => b.give + b.receive - (a.give + a.receive));
}

/** 某户头的全部条目，按日期倒序 */
export function entriesOfContact(entries: readonly Entry[], contactId: string): Entry[] {
  return entries
    .filter((e) => !e.deleted_at && e.contact_id === contactId)
    .sort((a, b) => String(b.happened_on).localeCompare(String(a.happened_on)));
}
