/**
 * 人情账 · 日期工具
 *
 * 全库日期统一是 'YYYY-MM-DD' 字符串。
 * 中国家庭的账本只关心「哪一天」，不关心时区瞬间，
 * 所以一律按 Asia/Shanghai 取「今天」，并且用字符串比较排序，避免 Date 对象的时区陷阱。
 */

export const TIMEZONE = 'Asia/Shanghai';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

const shanghaiParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** 取「今天」（按北京时间），返回 YYYY-MM-DD */
export function todayISO(now: Date = new Date()): string {
  const parts = shanghaiParts.formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '01';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** 当前年份（北京时间） */
export function currentYear(now: Date = new Date()): number {
  return Number(todayISO(now).slice(0, 4));
}

export function isISODate(s: unknown): s is string {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  // 正则只拦格式，这里再拦掉不存在的日历日期（如 2026-13-99、2023-02-29）
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const d = Number(s.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  // Date.UTC(y, m, 0) 即 y 年 m 月的最后一天（m=1→1月31日），用 UTC 避开时区陷阱
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= lastDay;
}

/** 非法日期回退到今天，保证界面永远有值可用 */
export function safeISO(s: unknown): string {
  return isISODate(s) ? s : todayISO();
}

/** '2026-05-01' → '2026年5月1日' */
export function formatCN(iso: string): string {
  if (!isISODate(iso)) return String(iso ?? '');
  const [y, m, d] = iso.split('-');
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/** '2026-05-01' → '5月1日' */
export function formatCNShort(iso: string): string {
  if (!isISODate(iso)) return String(iso ?? '');
  const [, m, d] = iso.split('-');
  return `${Number(m)}月${Number(d)}日`;
}

export function yearOf(iso: string): number {
  return Number(String(iso).slice(0, 4));
}

/** 1–12 */
export function monthOf(iso: string): number {
  return Number(String(iso).slice(5, 7));
}

/** 'YYYY-MM-DD' 是定长字典序，字符串比较即时间先后；不用 localeCompare，保证各环境结果一致 */
export function compareISO(a: string, b: string): number {
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** b 相对 a 过了几个整年（用于上浮计算） */
export function yearsBetween(fromISO: string, toISO: string): number {
  const fy = yearOf(fromISO);
  const ty = yearOf(toISO);
  let years = ty - fy;
  // 还没到今年的「对应月日」不算满一年：2020-06-01 → 2025-01-01 是 4 年，不是 5 年
  if (years > 0 && toISO.slice(5) < fromISO.slice(5)) years -= 1;
  return Math.max(0, years);
}

export function addYears(iso: string, n: number): string {
  if (!isISODate(iso)) return iso;
  const y = yearOf(iso) + n;
  return `${String(y).padStart(4, '0')}${iso.slice(4)}`;
}

/** 某年的起止（含） */
export function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

export function inYear(iso: string, year: number): boolean {
  return yearOf(iso) === year;
}

/** 用于「最近一次」比较：日期大的更新，日期相同则创建时间大的更新 */
export function isLaterThan(
  a: { happened_on: string; created_at?: string },
  b: { happened_on: string; created_at?: string },
): boolean {
  const c = compareISO(a.happened_on, b.happened_on);
  if (c !== 0) return c > 0;
  return String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) > 0;
}

export const MONTH_LABELS = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
] as const;
