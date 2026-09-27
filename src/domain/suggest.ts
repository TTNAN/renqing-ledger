/**
 * 人情账 · 还礼建议算法
 *
 * 这是整个应用最核心的一块，刻意写成「纯函数」：
 *   输入 → 输出，不碰 React、不碰数据库、不碰当前时间（时间由参数传入）。
 * 所以它可以被穷举单测，也可以在「模拟还礼」里凭空算一遍而不写账。
 *
 * 设计原则：
 *   1. 只给参考，不给结论。白事尤其如此——各地风俗差异极大。
 *   2. 一定要说清「为什么是这个数」，basis 里逐条列出用到的历史。
 *   3. 礼物估价默认不计入现金建议，只在依据里提一句。
 */

import { compareISO, todayISO, yearsBetween } from './date';
import { ceilToStep, floorToStep, roundToStep } from './money';
import { formatCents } from './money';
import { formatCN } from './date';
import type { Entry, EventType, Settings } from './types';
import { isSombre } from './types';

/** 一次还礼建议的输入 */
export interface SuggestInput {
  /** 该户头的全部条目（可含已删除，函数内自行过滤） */
  entries: readonly Entry[];
  /** 对方即将办事的类型 */
  targetType: EventType;
  /** 场次类型查找表：entry.event_id → 类型。缺省时同类判断会退化 */
  eventTypeOf?: (eventId: string) => EventType | undefined;
  /** 本次是「我出门随礼」(give) 还是「对方随给我」(receive) */
  direction: 'give' | 'receive';
  settings: Pick<Settings, 'round_to' | 'uplift_percent' | 'allow_below_history'>;
  /** 用于计算年份上浮的「今天」，默认取北京时间今天 */
  now?: string;
}

/** 还礼建议结果 */
export interface Suggestion {
  /** 建议区间下限（分） */
  suggested_min: number;
  /** 建议区间上限（分） */
  suggested_max: number;
  /** 主推金额（分）。无历史时为 null */
  suggested_primary: number | null;
  /** 中文计算依据，逐条列出 */
  basis: string[];
  /** 需要提醒用户注意的话 */
  warnings: string[];
  /** 是否有可参考的历史 */
  has_history: boolean;
}

/* ------------------------------------------------------------------ 内部工具 */

/** 现金部分。礼物估价默认不算钱 */
function cashOf(e: Entry): number {
  return Math.max(0, Math.round(e.amount_cents || 0));
}

/** 这条记录里有没有「礼物」成分 */
function hasGoods(e: Entry): boolean {
  return e.gift_kind === 'goods' || e.gift_kind === 'both';
}

/** 礼物的中文描述，如「茅台一瓶（约¥800）」 */
function goodsText(e: Entry): string {
  const desc = (e.goods_desc || '').trim();
  const val = Math.max(0, Math.round(e.goods_value_cents || 0));
  if (desc && val > 0) return `${desc}（估价 ${formatCents(val)}）`;
  if (desc) return desc;
  if (val > 0) return `礼物（估价 ${formatCents(val)}）`;
  return '礼物';
}

function isAlive(e: Entry): boolean {
  return !e.deleted_at;
}

/** 按日期倒序（新的在前） */
function byDateDesc(a: Entry, b: Entry): number {
  const c = compareISO(b.happened_on, a.happened_on);
  if (c !== 0) return c;
  return String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
}

/* ------------------------------------------------------------------ 主函数 */

export function suggestGiftAmount(input: SuggestInput): Suggestion {
  const {
    entries,
    targetType,
    eventTypeOf,
    direction,
    settings,
    now = todayISO(),
  } = input;

  const basis: string[] = [];
  const warnings: string[] = [];
  const step = Math.max(1, settings.round_to) * 100; // 元 → 分
  const sombre = isSombre(targetType);

  /* --- 1. 过滤未删除条目 --- */
  const alive = entries.filter(isAlive).slice().sort(byDateDesc);

  if (alive.length === 0) {
    return {
      suggested_min: 0,
      suggested_max: 0,
      suggested_primary: null,
      basis: ['这一户还没有任何往来记录。'],
      warnings: ['没有历史可参考，请按亲疏远近和当地礼金起步价来定。'],
      has_history: false,
    };
  }

  /* --- 2/3. 同类最近一次随出、最近一次随出、最近一次收来 ---
   * 只有「有现金」的记录才能当锚点：纯礼物记录（amount=0）不能拿来定价。 */
  const gives = alive.filter((e) => e.direction === 'give');
  const receives = alive.filter((e) => e.direction === 'receive');
  const givesCash = gives.filter((e) => cashOf(e) > 0);
  const receivesCash = receives.filter((e) => cashOf(e) > 0);

  const typeOf = (e: Entry): EventType | undefined => eventTypeOf?.(e.event_id);

  const sameTypeGive = eventTypeOf
    ? givesCash.find((e) => typeOf(e) === targetType)
    : undefined;

  const lastGive = givesCash[0];
  const lastReceive = receivesCash[0];

  /* --- 4. 净往来：正数表示对方累计给我更多 --- */
  const sumGive = gives.reduce((acc, e) => acc + cashOf(e), 0);
  const sumReceive = receives.reduce((acc, e) => acc + cashOf(e), 0);
  const net = sumReceive - sumGive;

  /* 该户历史上的最低正金额（含收来），白事和下限都会用到 */
  const positiveAmounts = alive
    .map(cashOf)
    .filter((c) => c > 0);
  const historyMin = positiveAmounts.length > 0 ? Math.min(...positiveAmounts) : 0;

  /* --- 5. primary 初值 ---
   * 喜事：同类历史 → 对方最近随来 → 我最近随出
   * 白事：同类历史 → 我最近随出 → 对方最近随来
   * 白事之所以不优先看「对方随来」，是因为那通常是喜事上的人情，
   * 直接搬到白事上会把金额抬得过高，违背「白事不加码」。 */
  let primary: number | null = null;
  let primarySource = '';

  const anchor: Entry | undefined = sameTypeGive
    ? sameTypeGive
    : sombre
      ? (lastGive ?? lastReceive)
      : (lastReceive ?? lastGive);

  if (anchor) {
    primary = cashOf(anchor);
    if (anchor === sameTypeGive) {
      primarySource = 'same_type';
      basis.push(
        `${formatCN(anchor.happened_on)} 他家办「${targetType}」，你随了 ${formatCents(primary)}。`,
      );
    } else if (anchor.direction === 'receive') {
      primarySource = 'last_receive';
      basis.push(
        `${formatCN(anchor.happened_on)} 你家办事，对方随来 ${formatCents(primary)}。`,
      );
    } else {
      primarySource = 'last_give';
      const t = typeOf(anchor);
      basis.push(
        `${formatCN(anchor.happened_on)} ${t ? `他家办「${t}」` : '他家办事'}，你随了 ${formatCents(primary)}。`,
      );
    }
  }

  if (primary === null) {
    // 有记录但金额全为 0（例如只记了礼物）——仍然不算「有钱可参考」
    const goodsOnly = alive.filter(hasGoods);
    if (goodsOnly.length > 0) {
      basis.push(`这一户有 ${goodsOnly.length} 笔礼物往来，但都没有现金金额。`);
    }
    return {
      suggested_min: 0,
      suggested_max: 0,
      suggested_primary: null,
      basis,
      warnings: ['没有可参考的现金金额，请按亲疏远近和当地礼金起步价来定。'],
      has_history: false,
    };
  }

  /* --- 6. 净往来为正且本次是随出：不要显得比对方少太多 --- */
  if (!sombre && net > 0 && direction === 'give' && lastReceive) {
    const receiveAmt = cashOf(lastReceive);
    if (receiveAmt > primary) {
      basis.push(
        `对方累计随来 ${formatCents(sumReceive)}，你累计随出 ${formatCents(sumGive)}，` +
          `对方多出 ${formatCents(net)}；为不低于对方最近一次 ${formatCents(receiveAmt)}，本次取该值。`,
      );
      primary = receiveAmt;
      primarySource = 'net_receive_floor';
    } else {
      basis.push(
        `对方累计多出 ${formatCents(net)}，本次不低于对方最近一次随来的 ${formatCents(receiveAmt)}。`,
      );
    }
  }

  /* --- 7. 白事：独立规则，不因净往来为正而加码 --- */
  if (sombre) {
    const sameTypeAmount = sameTypeGive ? cashOf(sameTypeGive) : 0;
    const floor = Math.max(sameTypeAmount, historyMin);
    if (floor > primary) {
      basis.push(
        `按白事惯例，不低于该户历史上的最低金额 ${formatCents(floor)}。`,
      );
      primary = floor;
      primarySource = 'funeral_floor';
    }
    warnings.push('白事按各地习俗差异很大，系统只给历史参考，不自动加码。');
    if (settings.uplift_percent > 0) {
      warnings.push('白事不适用年份上浮，本次已忽略「上浮百分比」设置。');
    }
  }

  /* --- 8. 年份上浮（白事跳过） --- */
  if (!sombre && settings.uplift_percent > 0 && primarySource !== '') {
    // 参考日期必须跟金额的真实来源一致：
    // 净往来保底把 primary 覆盖成 lastReceive 后，年数也要按那一笔的年份算，
    // 不能再按同类随出的日期算——否则依据里「距今 X 年」和金额的年份对不上。
    const refEntry =
      primarySource === 'net_receive_floor'
        ? lastReceive
        : (sameTypeGive ??
          (primarySource === 'last_receive' ? lastReceive : lastGive)) ??
        alive[0]!;
    const years = yearsBetween(refEntry.happened_on, now);
    if (years > 0) {
      const before = primary;
      primary = Math.round(primary * (1 + (settings.uplift_percent / 100) * years));
      basis.push(
        `按每年上浮 ${settings.uplift_percent}%、距今 ${years} 年计算：` +
          `${formatCents(before)} → ${formatCents(primary)}。`,
      );
    }
  }

  /* --- 9. 取整 --- */
  const rounded = roundToStep(primary, step);
  if (rounded !== primary) {
    basis.push(
      `按「取整到 ${settings.round_to} 元」的设置为 ${formatCents(rounded)}。`,
    );
  }
  primary = rounded;

  /* --- 10. 区间 --- */
  const max = primary + step;
  let min = primary - step;

  // 下限不能低于历史最低（除非用户显式允许）
  if (!settings.allow_below_history && historyMin > 0) {
    min = Math.max(min, floorToStep(historyMin, step) || historyMin);
  }
  min = Math.max(0, min);
  // 注：min 不可能超过 max（下限至多被抬到 primary 附近），
  // 所以不需要「区间被挤没时强行撑开」的逻辑——硬撑反而会打破上面的下限约束。

  /* --- 11. 依据收尾 --- */
  if (gives.length > 0 || receives.length > 0) {
    basis.push(
      `合计：你累计随出 ${formatCents(sumGive)}，对方累计随来 ${formatCents(sumReceive)}，` +
        (net === 0
          ? '两边持平。'
          : net > 0
            ? `目前对方多出 ${formatCents(net)}。`
            : `目前你多出 ${formatCents(-net)}。`),
    );
  }

  // 礼物只在依据里提一句，不进金额
  const goodsEntries = alive.filter(hasGoods);
  if (goodsEntries.length > 0) {
    const latest = goodsEntries[0]!;
    basis.push(
      `另有礼物往来（${formatCN(latest.happened_on)} ${goodsText(latest)}），` +
        `礼物估价不计入现金建议。`,
    );
  }

  if (sombre) {
    warnings.push('建议金额仅供参考，请以当地风俗和家中长辈的意见为准。');
  }

  return {
    suggested_min: min,
    suggested_max: max,
    suggested_primary: primary,
    basis,
    warnings,
    has_history: true,
  };
}

/**
 * 便捷函数：直接给出「还礼该给多少」的一句话摘要。
 * 用于列表页快速预览。
 */
export function suggestionSummary(s: Suggestion): string {
  if (s.suggested_primary === null) return '暂无历史可参考';
  if (s.suggested_min === s.suggested_max) return formatCents(s.suggested_primary);
  return `${formatCents(s.suggested_min)} – ${formatCents(s.suggested_max)}`;
}

/** 供「模拟还礼」用的空建议（无历史） */
export const EMPTY_SUGGESTION: Suggestion = {
  suggested_min: 0,
  suggested_max: 0,
  suggested_primary: null,
  basis: [],
  warnings: [],
  has_history: false,
};

/** 供测试与调试：把区间向上取整到档位（部分场景用得到） */
export function snapRangeUp(
  min: number,
  max: number,
  stepCents: number,
): { min: number; max: number } {
  return { min: floorToStep(min, stepCents), max: ceilToStep(max, stepCents) };
}
