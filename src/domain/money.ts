/**
 * 人情账 · 金额工具
 *
 * 铁律：金额一律以「整数分」参与运算。
 * 任何地方都不允许出现 `a + b` 直接相加人民币浮点数。
 * 界面上输入输出都经过这里，中文习惯写法（800元 / 捌佰 / 一千二 / 三块五）也在这里解析。
 */

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 洞: 0,
  一: 1, 壹: 1, 幺: 1,
  二: 2, 贰: 2, 两: 2, 俩: 2,
  三: 3, 叁: 3,
  四: 4, 肆: 4,
  五: 5, 伍: 5,
  六: 6, 陆: 6,
  七: 7, 柒: 7,
  八: 8, 捌: 8,
  九: 9, 玖: 9,
};

const CN_UNITS: Record<string, number> = {
  十: 10, 拾: 10,
  百: 100, 佰: 100,
  千: 1000, 仟: 1000,
  万: 10000, 萬: 10000,
  亿: 100000000, 億: 100000000,
};

/** 全角转半角、去掉千分位与货币符号 */
function normalizeInput(raw: string): string {
  let s = String(raw ?? '');
  // 全角数字与全角句点
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/[．。]/g, '.');
  s = s.replace(/[，,]/g, '');
  s = s.replace(/[￥¥]/g, '');
  s = s.replace(/(人民币|RMB|rmb|CNY|cny)/g, '');
  return s.trim();
}

/**
 * 解析中文数字。返回整数（元），无法解析返回 null。
 *
 * 支持口语简写：「一千二」= 1200、「两百五」= 250、「三十五」= 35。
 * 但「一百零五」因为有「零」不会被误判成 150。
 */
export function parseChineseNumber(raw: string): number | null {
  const s = String(raw ?? '').replace(/\s/g, '');
  if (!s) return null;

  let total = 0; // 已结算的大段（亿/万级）
  let section = 0; // 当前万以下的段
  let pending = 0; // 尚未乘单位的数字
  let lastUnit = 0; // 最近一个单位，用于口语简写
  let zeroAfterUnit = false;
  let lastWasDigit = false;
  let lastDigit = 0;
  let sawAnything = false;

  for (const ch of s) {
    // 允许中文数字里混写阿拉伯数字，如「零5」「1万2」
    const d = CN_DIGITS[ch] ?? (/[0-9]/.test(ch) ? Number(ch) : undefined);
    if (d !== undefined) {
      pending = d;
      lastWasDigit = true;
      lastDigit = d;
      if (d === 0) zeroAfterUnit = true;
      sawAnything = true;
      continue;
    }

    const u = CN_UNITS[ch];
    if (u === undefined) return null;

    if (u >= 10000) {
      section = (section + pending) * u;
      total += section;
      section = 0;
    } else {
      // 「十五」这种省略了前面的一
      if (pending === 0 && u === 10 && section === 0 && total === 0) pending = 1;
      section += pending * u;
    }
    pending = 0;
    lastUnit = u;
    zeroAfterUnit = false;
    lastWasDigit = false;
    sawAnything = true;
  }

  if (!sawAnything) return null;

  let value = total + section + pending;

  // 口语简写修正：「一千二」→ 1200，而不是 1002
  if (lastWasDigit && lastUnit >= 10 && !zeroAfterUnit) {
    const base = total + section;
    value = base + lastDigit * (lastUnit / 10);
  }

  return value;
}

/**
 * 把用户输入解析成整数分。识别不了返回 null。
 *
 *   '800'      → 80000
 *   '800元'    → 80000
 *   '800.5'    → 80050
 *   '捌佰'     → 80000
 *   '一千二'   → 120000
 *   '三块五'   → 350
 *   '3块5毛'   → 350
 */
export function parseMoneyToCents(raw: string): number | null {
  let s = normalizeInput(raw);
  if (!s) return null;

  // 负号在记账里没有意义，直接拒绝
  if (s.includes('-')) return null;

  // 「三块五」「3元2角」：拆成 元 + 角分
  const jiaoFen = s.match(/^(.*?)(?:块|元|圆)(.*)$/);
  if (jiaoFen) {
    const head = jiaoFen[1] ?? '';
    const tail = (jiaoFen[2] ?? '').replace(/整$/, '');
    const yuan = parseYuanPart(head);
    if (yuan === null) return null;
    const cents = parseJiaoFen(tail);
    if (cents === null) return null;
    return yuan * 100 + cents;
  }

  const yuan = parseYuanPart(s);
  return yuan === null ? null : yuan * 100;
}

/** 解析「元」部分（整数或小数） */
function parseYuanPart(s: string): number | null {
  const t = s.replace(/(整|元|块|圆)/g, '').trim();
  if (!t) return 0;

  /*
   * 纯阿拉伯数字（可带小数）。
   * 末尾的点号也接受 —— 手机上一边打字一边输入时，
   * 「800.」是个必然出现的中间态（打完整数点小数点，还没打小数位）。
   * 不接受的话那一刻输入框会闪红字报错，体验很差。
   */
  if (/^\d+(\.\d*)?$/.test(t)) {
    const n = parseFloat(t.endsWith('.') ? t.slice(0, -1) : t);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100) / 100;
  }

  // 阿拉伯 + 中文单位混写，如「1万2」「3千」
  if (/[0-9]/.test(t) && /[十百千万亿拾佰仟萬億]/.test(t)) {
    const mixed = parseMixedNumber(t);
    if (mixed !== null) return mixed;
  }

  return parseChineseNumber(t);
}

/** 「1万2」「3千5」这类混写 */
function parseMixedNumber(s: string): number | null {
  const re = /(\d+(?:\.\d+)?)|([十百千万亿拾佰仟萬億])/g;
  let m: RegExpExecArray | null;
  let total = 0;
  let section = 0;
  let pending: number | null = null;
  let lastUnit = 0;
  let lastWasDigit = false;
  let lastDigit = 0;

  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) {
      pending = parseFloat(m[1]);
      lastWasDigit = true;
      lastDigit = pending;
      continue;
    }
    const u = CN_UNITS[m[2] as string];
    if (u === undefined) return null;
    const n = pending ?? 0;
    if (u >= 10000) {
      section = (section + n) * u;
      total += section;
      section = 0;
    } else {
      section += n * u;
    }
    pending = null;
    lastUnit = u;
    lastWasDigit = false;
  }

  let value = total + section + (pending ?? 0);
  if (lastWasDigit && lastUnit >= 10) {
    value = total + section + lastDigit * (lastUnit / 10);
  }
  return value;
}

/** 解析「五毛」「五角」「三分」→ 分 */
function parseJiaoFen(s: string): number | null {
  const t = s.replace(/\s/g, '');
  if (!t) return 0;

  // 纯数字，如「3块50」→ 50 分？按角分两位处理
  if (/^\d+$/.test(t)) {
    if (t.length === 1) return parseInt(t, 10) * 10; // 3块5 = 3.5元
    return parseInt(t.slice(0, 2).padEnd(2, '0'), 10); // 3块55 = 3.55元
  }

  let cents = 0;
  let matched = false;
  const re = /([零〇一二三四五六七八九壹贰叁肆伍陆柒捌玖两\d]+)(毛|角|分)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const n = /^\d+$/.test(m[1]!) ? parseInt(m[1]!, 10) : parseChineseNumber(m[1]!);
    if (n === null) return null;
    cents += m[2] === '分' ? n : n * 10;
    matched = true;
  }
  if (!matched) {
    // 只说「五」→ 五毛
    const n = /^\d+$/.test(t) ? parseInt(t, 10) : parseChineseNumber(t);
    if (n === null) return null;
    cents = n * 10;
  }
  return cents;
}

/* ------------------------------------------------------------------ 换算 */

/** 元 → 分（四舍五入到分） */
export function yuanToCents(yuan: number): number {
  return Math.round(yuan * 100);
}

/** 分 → 元（仅供展示，不参与运算） */
export function centsToYuan(cents: number): number {
  return cents / 100;
}

/* ------------------------------------------------------------------ 取整 */

/** 按档位取整（四舍五入到最近的 step 分） */
export function roundToStep(cents: number, stepCents: number): number {
  if (stepCents <= 0) return Math.round(cents);
  return Math.round(cents / stepCents) * stepCents;
}

/** 向下取整到档位 */
export function floorToStep(cents: number, stepCents: number): number {
  if (stepCents <= 0) return Math.floor(cents);
  return Math.floor(cents / stepCents) * stepCents;
}

/** 向上取整到档位 */
export function ceilToStep(cents: number, stepCents: number): number {
  if (stepCents <= 0) return Math.ceil(cents);
  return Math.ceil(cents / stepCents) * stepCents;
}

/* ------------------------------------------------------------------ 展示 */

export interface FormatOptions {
  /** 是否带 ¥ 符号 */
  symbol?: boolean;
  /** 'auto' 时整数元不显示小数；否则固定小数位 */
  decimals?: 'auto' | 0 | 2;
  /** 是否显示千分位，默认显示 */
  grouping?: boolean;
}

/**
 * 格式化金额。默认「¥1,200」，有零头时「¥1,200.50」。
 */
export function formatCents(cents: number, opts: FormatOptions = {}): string {
  const { symbol = true, decimals = 'auto', grouping = true } = opts;
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));

  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;

  const useDecimals = decimals === 2 || (decimals === 'auto' && fen !== 0);
  let intPart = String(yuan);
  if (grouping) intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const decPart = useDecimals ? '.' + String(fen).padStart(2, '0') : '';

  return `${negative ? '-' : ''}${symbol ? '¥' : ''}${intPart}${decPart}`;
}

/** 只要数字，用于输入框回填：1200.50 → "1200.50"，800 → "800" */
export function centsToInput(cents: number): string {
  const abs = Math.abs(Math.round(cents));
  const yuan = Math.floor(abs / 100);
  const fen = abs % 100;
  return fen === 0 ? String(yuan) : `${yuan}.${String(fen).padStart(2, '0')}`;
}

/** 带正负号的展示，用于往来净额 */
export function formatSignedCents(cents: number): string {
  if (cents === 0) return formatCents(0);
  return (cents > 0 ? '+' : '-') + formatCents(Math.abs(cents));
}
