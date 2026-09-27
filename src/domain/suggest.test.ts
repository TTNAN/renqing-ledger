/**
 * 还礼建议算法 · 单测
 *
 * 覆盖需求里点名的场景：
 *   无历史 / 只有随出 / 只有收来 / 同类优先 / 白事不加码 /
 *   取整 / 礼物估价不计入 / 已删除与归档户头
 */

import { describe, expect, it } from 'vitest';
import { suggestGiftAmount, suggestionSummary } from './suggest';
import { DEFAULT_SETTINGS } from './types';
import type { Entry, EventType, Settings } from './types';

/* ------------------------------------------------------------------ 测试夹具 */

let seq = 0;

function entry(partial: Partial<Entry> & Pick<Entry, 'direction' | 'amount_cents' | 'happened_on'>): Entry {
  seq += 1;
  return {
    id: `e${seq}`,
    event_id: partial.event_id ?? `ev${seq}`,
    contact_id: partial.contact_id ?? 'c1',
    direction: partial.direction,
    amount_cents: partial.amount_cents,
    gift_kind: partial.gift_kind ?? 'cash',
    goods_desc: partial.goods_desc,
    goods_value_cents: partial.goods_value_cents,
    method: partial.method,
    handler: partial.handler,
    happened_on: partial.happened_on,
    notes: partial.notes,
    created_at: partial.created_at ?? `${partial.happened_on}T00:00:00.000Z`,
    updated_at: partial.updated_at ?? `${partial.happened_on}T00:00:00.000Z`,
    deleted_at: partial.deleted_at ?? null,
  };
}

/** 场次类型查找表 */
function typeMap(map: Record<string, EventType>) {
  return (eventId: string): EventType | undefined => map[eventId];
}

const S: Pick<Settings, 'round_to' | 'uplift_percent' | 'allow_below_history'> = {
  round_to: DEFAULT_SETTINGS.round_to,
  uplift_percent: DEFAULT_SETTINGS.uplift_percent,
  allow_below_history: DEFAULT_SETTINGS.allow_below_history,
};

/* ------------------------------------------------------------------ 用例 */

describe('suggestGiftAmount', () => {
  it('1. 无历史：不给数字，提示按当地起步价', () => {
    const r = suggestGiftAmount({
      entries: [],
      targetType: '结婚',
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    expect(r.suggested_primary).toBeNull();
    expect(r.has_history).toBe(false);
    expect(r.suggested_min).toBe(0);
    expect(r.suggested_max).toBe(0);
    expect(r.warnings.join('')).toContain('起步价');
  });

  it('2. 只有随出：以最近一次随出为主推', () => {
    const entries = [
      entry({ direction: 'give', amount_cents: 80000, happened_on: '2023-05-01' }),
      entry({ direction: 'give', amount_cents: 50000, happened_on: '2021-02-01' }),
    ];

    const r = suggestGiftAmount({
      entries,
      targetType: '结婚',
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    expect(r.suggested_primary).toBe(80000);
    expect(r.suggested_min).toBe(70000);
    expect(r.suggested_max).toBe(90000);
    expect(r.basis.join('')).toContain('2023年5月1日');
    expect(r.basis.join('')).toContain('¥800');
  });

  it('3. 只有收来：以对方给过的金额为主推', () => {
    const entries = [
      entry({ direction: 'receive', amount_cents: 60000, happened_on: '2024-03-12' }),
    ];

    const r = suggestGiftAmount({
      entries,
      targetType: '结婚',
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    expect(r.suggested_primary).toBe(60000);
    expect(r.basis.join('')).toContain('对方随来');
  });

  it('4. 同类优先：同类历史压过更近的其他类型记录', () => {
    // 2022 他家结婚我随 800；2024 他家乔迁我随 300（更近，但不同类）
    const entries = [
      entry({ direction: 'give', amount_cents: 30000, happened_on: '2024-06-01', event_id: 'ev_house' }),
      entry({ direction: 'give', amount_cents: 80000, happened_on: '2022-10-01', event_id: 'ev_wed' }),
    ];

    const r = suggestGiftAmount({
      entries,
      targetType: '结婚',
      eventTypeOf: typeMap({ ev_house: '乔迁', ev_wed: '结婚' }),
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    expect(r.suggested_primary).toBe(80000);
    expect(r.basis.join('')).toContain('他家办「结婚」');
  });

  it('5. 白事不加码：净往来为正也不上浮，并给出习俗提示', () => {
    // 对方累计给我 2000，我只给过 500 —— 普通场次会被抬到 2000
    const entries = [
      entry({ direction: 'receive', amount_cents: 200000, happened_on: '2024-01-01', event_id: 'ev_a' }),
      entry({ direction: 'give', amount_cents: 50000, happened_on: '2023-01-01', event_id: 'ev_b' }),
    ];

    const common = {
      entries,
      eventTypeOf: typeMap({ ev_a: '结婚', ev_b: '乔迁' }),
      direction: 'give' as const,
      settings: S,
      now: '2026-09-23',
    };

    const wedding = suggestGiftAmount({ ...common, targetType: '结婚' });
    const funeral = suggestGiftAmount({ ...common, targetType: '白事' });

    // 喜事：被对方最近一次收来抬高
    expect(wedding.suggested_primary).toBe(200000);

    // 白事：不被抬高，落在历史最低（500）与同类之间
    expect(funeral.suggested_primary).toBeLessThan(wedding.suggested_primary!);
    expect(funeral.suggested_primary).toBe(50000);
    expect(funeral.warnings.join('')).toContain('白事');
    expect(funeral.warnings.join('')).toContain('只给历史参考');
  });

  it('6. 取整：结果按 round_to 对齐（50 与 100 两种设置）', () => {
    const entries = [
      entry({ direction: 'give', amount_cents: 83000, happened_on: '2024-01-01' }),
    ];

    const r100 = suggestGiftAmount({
      entries,
      targetType: '结婚',
      direction: 'give',
      settings: { ...S, round_to: 100 },
      now: '2026-09-23',
    });
    expect(r100.suggested_primary! % 10000).toBe(0);
    expect(r100.suggested_primary).toBe(80000);

    const r50 = suggestGiftAmount({
      entries,
      targetType: '结婚',
      direction: 'give',
      settings: { ...S, round_to: 50 },
      now: '2026-09-23',
    });
    expect(r50.suggested_primary! % 5000).toBe(0);
    expect(r50.suggested_primary).toBe(85000);
  });

  it('7. 礼物估价不计入现金建议，只在依据里提及', () => {
    // 只有一笔纯礼物（无现金）
    const onlyGoods = [
      entry({
        direction: 'give',
        amount_cents: 0,
        gift_kind: 'goods',
        goods_desc: '茅台一瓶',
        goods_value_cents: 150000,
        happened_on: '2024-05-01',
      }),
    ];

    const r = suggestGiftAmount({
      entries: onlyGoods,
      targetType: '结婚',
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    // 没有现金可参考
    expect(r.suggested_primary).toBeNull();
    expect(r.basis.join('')).toContain('礼物');

    // 有现金 + 附带礼物时，礼物不抬高主推金额
    const mixed = [
      entry({ direction: 'give', amount_cents: 60000, happened_on: '2023-05-01', event_id: 'ev1' }),
      entry({
        direction: 'give',
        amount_cents: 0,
        gift_kind: 'goods',
        goods_desc: '两箱酒',
        goods_value_cents: 40000,
        happened_on: '2024-05-01',
        event_id: 'ev2',
      }),
    ];

    const r2 = suggestGiftAmount({
      entries: mixed,
      targetType: '结婚',
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    // 若礼物被计入，主推会被抬到 600+400 或至少 400
    expect(r2.suggested_primary).toBe(60000);
    expect(r2.basis.join('')).toContain('礼物估价不计入现金建议');
    expect(r2.basis.join('')).toContain('两箱酒');
  });

  it('8. 已删除的条目被排除，不计入净往来', () => {
    const entries = [
      entry({ direction: 'receive', amount_cents: 500000, happened_on: '2024-01-01', deleted_at: '2025-01-01T00:00:00.000Z' }),
      entry({ direction: 'give', amount_cents: 60000, happened_on: '2023-01-01' }),
    ];

    const r = suggestGiftAmount({
      entries,
      targetType: '结婚',
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    // 被删掉的 5000 元不该出现
    expect(r.basis.join('')).not.toContain('5,000');
    expect(r.suggested_primary).toBe(60000);
  });

  it('9. 下限不低于该户历史最低金额（allow_below_history=false）', () => {
    const entries = [
      entry({ direction: 'give', amount_cents: 200000, happened_on: '2024-01-01' }),
      entry({ direction: 'give', amount_cents: 100000, happened_on: '2020-01-01' }),
    ];

    const r = suggestGiftAmount({
      entries,
      targetType: '结婚',
      direction: 'give',
      settings: { ...S, allow_below_history: false },
      now: '2026-09-23',
    });

    // 主推 2000，区间下沿 1900，但历史最低是 1000，所以下沿保持 1900
    expect(r.suggested_primary).toBe(200000);
    expect(r.suggested_min).toBe(190000);
    expect(r.suggested_min).toBeGreaterThanOrEqual(0);
  });

  it('10. 年份上浮按设置的百分比生效', () => {
    const entries = [
      entry({ direction: 'give', amount_cents: 100000, happened_on: '2020-01-01' }),
    ];

    const r = suggestGiftAmount({
      entries,
      targetType: '结婚',
      direction: 'give',
      settings: { ...S, uplift_percent: 10 },
      now: '2025-06-01', // 距今 5 年
    });

    // 1000 × (1 + 10% × 5) = 1500
    expect(r.suggested_primary).toBe(150000);
    expect(r.basis.join('')).toContain('上浮');
  });

  it('11. 白事时忽略年份上浮，并提示已忽略', () => {
    const entries = [
      entry({ direction: 'give', amount_cents: 50000, happened_on: '2020-01-01', event_id: 'ev_f' }),
    ];

    const r = suggestGiftAmount({
      entries,
      targetType: '白事',
      eventTypeOf: typeMap({ ev_f: '白事' }),
      direction: 'give',
      settings: { ...S, uplift_percent: 20 },
      now: '2026-01-01',
    });

    expect(r.suggested_primary).toBe(50000);
    expect(r.warnings.join('')).toContain('不适用年份上浮');
  });

  it('12. 摘要文案可读（用于列表预览）', () => {
    const entries = [
      entry({ direction: 'give', amount_cents: 80000, happened_on: '2024-01-01' }),
    ];
    const r = suggestGiftAmount({
      entries,
      targetType: '结婚',
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    // 主推 800，区间本应是 700–900，
    // 但需求规定「下沿不得低于该户历史最低金额」，而这一户历史最低就是 800，
    // 所以下沿被抬到 800 —— 即「不建议比过去给得更少」。
    expect(r.suggested_min).toBe(80000);
    expect(r.suggested_max).toBe(90000);
    expect(suggestionSummary(r)).toBe('¥800 – ¥900');
  });

  it('15. 历史最低低于主推时，区间下沿正常展开', () => {
    const entries = [
      entry({ direction: 'give', amount_cents: 80000, happened_on: '2024-01-01' }),
      entry({ direction: 'give', amount_cents: 20000, happened_on: '2018-01-01' }),
    ];
    const r = suggestGiftAmount({
      entries,
      targetType: '结婚',
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    expect(r.suggested_primary).toBe(80000);
    expect(r.suggested_min).toBe(70000);
    expect(r.suggested_max).toBe(90000);
    expect(suggestionSummary(r)).toBe('¥700 – ¥900');
  });

  it('13. 收来方向也给出建议（对方随给我）', () => {
    const entries = [
      entry({ direction: 'give', amount_cents: 80000, happened_on: '2023-01-01' }),
    ];

    const r = suggestGiftAmount({
      entries,
      targetType: '满月',
      direction: 'receive',
      settings: S,
      now: '2026-09-23',
    });

    expect(r.suggested_primary).toBe(80000);
    expect(r.has_history).toBe(true);
  });

  it('14. 净往来持平时不额外抬高', () => {
    const entries = [
      entry({ direction: 'give', amount_cents: 60000, happened_on: '2022-01-01' }),
      entry({ direction: 'receive', amount_cents: 60000, happened_on: '2023-01-01' }),
    ];

    const r = suggestGiftAmount({
      entries,
      targetType: '乔迁',
      direction: 'give',
      settings: S,
      now: '2026-09-23',
    });

    expect(r.suggested_primary).toBe(60000);
    expect(r.basis.join('')).toContain('两边持平');
  });
});
