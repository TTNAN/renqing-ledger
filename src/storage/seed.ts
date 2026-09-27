/**
 * 人情账 · 示例账本
 *
 * ⚠️ 以下全部是虚构数据，姓名、金额、地点均为编写方便而设，
 *    与任何真实人物、家庭无关。仅供试用与演示。
 *
 * 这份种子刻意安排成「能算出不同建议」：
 *   - 张叔   ：有来有往，同类历史齐全 → 走「同类优先」
 *   - 李娜   ：只有我随出过 → 走「最近随出」
 *   - 王阿姨 ：只有她随来 → 走「对方随来」
 *   - 赵强   ：白事 → 走白事独立规则
 *   - 陈老师 ：只有礼物往来 → 走「无现金可参考」
 */

import type { Contact, Entry, Event, LedgerData } from '@/domain/types';
import { DEFAULT_SETTINGS } from '@/domain/types';

const CREATED = '2026-01-01T00:00:00.000Z';

function stamp<T extends object>(obj: T): T & { created_at: string; updated_at: string } {
  return { ...obj, created_at: CREATED, updated_at: CREATED };
}

export function buildSeedLedger(): LedgerData {
  const contacts: Contact[] = [
    stamp({
      id: 'c_zhang',
      display_name: '张叔',
      legal_name: '张建国',
      aliases: ['三舅', '母舅张家'],
      relation: '亲戚' as const,
      clan_or_branch: '妈妈这边',
      phone: '138****0000',
      notes: '妈妈的堂弟，住城东。家里办事都到场。',
      archived: false,
      deleted_at: null,
    }),
    stamp({
      id: 'c_lina',
      display_name: '李娜',
      legal_name: '李娜',
      aliases: ['娜姐'],
      relation: '同事' as const,
      clan_or_branch: '同事组',
      notes: '同部门，2019 年一起做过项目。',
      archived: false,
      deleted_at: null,
    }),
    stamp({
      id: 'c_wang',
      display_name: '隔壁王阿姨',
      aliases: ['王姨', '楼下王家'],
      relation: '邻居' as const,
      clan_or_branch: '小区邻居',
      notes: '对门住了十几年，孩子跟我家孩子同岁。',
      archived: false,
      deleted_at: null,
    }),
    stamp({
      id: 'c_zhao',
      display_name: '高中同学赵强',
      aliases: ['赵强', '强子'],
      relation: '同学' as const,
      clan_or_branch: '高中同学',
      notes: '高中同桌，多年没联系，去年他父亲过世。',
      archived: false,
      deleted_at: null,
    }),
    stamp({
      id: 'c_chen',
      display_name: '陈老师',
      aliases: ['孩子班主任'],
      relation: '其他' as const,
      clan_or_branch: '孩子学校',
      notes: '孩子小学班主任，逢年过节送点东西，没有现金往来。',
      archived: false,
      deleted_at: null,
    }),
  ];

  const events: Event[] = [
    stamp({
      id: 'ev_2021_wedding',
      title: '我家结婚',
      type: '结婚' as const,
      date: '2021-10-02',
      host_side: 'self' as const,
      host_contact_id: null,
      location: '老家县城',
      notes: '自家办的第一场大事，礼簿记了三本。',
      deleted_at: null,
    }),
    stamp({
      id: 'ev_2023_zhang',
      title: '张叔儿子结婚',
      type: '结婚' as const,
      date: '2023-05-01',
      host_side: 'other' as const,
      host_contact_id: 'c_zhang',
      location: '城东饭店',
      notes: '全家去吃的席。',
      deleted_at: null,
    }),
    stamp({
      id: 'ev_2024_lina',
      title: '李娜家满月',
      type: '满月' as const,
      date: '2024-03-12',
      host_side: 'other' as const,
      host_contact_id: 'c_lina',
      location: '单位附近',
      notes: '包了红包没吃饭。',
      deleted_at: null,
    }),
    stamp({
      id: 'ev_2025_wang',
      title: '王阿姨家乔迁',
      type: '乔迁' as const,
      date: '2025-08-16',
      host_side: 'other' as const,
      host_contact_id: 'c_wang',
      location: '新小区 3 号楼',
      notes: '',
      deleted_at: null,
    }),
    stamp({
      id: 'ev_2026_zhao',
      title: '赵强父亲白事',
      type: '白事' as const,
      date: '2026-02-08',
      host_side: 'other' as const,
      host_contact_id: 'c_zhao',
      location: '老家镇上',
      notes: '只随礼未到场，托同学带过去。',
      deleted_at: null,
    }),
    stamp({
      id: 'ev_2024_zhang_house',
      title: '张叔家乔迁',
      type: '乔迁' as const,
      date: '2024-06-01',
      host_side: 'other' as const,
      host_contact_id: 'c_zhang',
      location: '城东新居',
      notes: '',
      deleted_at: null,
    }),
  ];

  const entries: Entry[] = [
    /* --- 2021 我家结婚：收礼 --- */
    stamp({
      id: 'en_1',
      event_id: 'ev_2021_wedding',
      contact_id: 'c_zhang',
      direction: 'receive' as const,
      amount_cents: 120000,
      gift_kind: 'cash' as const,
      method: '红包' as const,
      handler: '我',
      happened_on: '2021-10-02',
      notes: '',
      deleted_at: null,
    }),
    stamp({
      id: 'en_2',
      event_id: 'ev_2021_wedding',
      contact_id: 'c_wang',
      direction: 'receive' as const,
      amount_cents: 60000,
      gift_kind: 'cash' as const,
      method: '红包' as const,
      handler: '我',
      happened_on: '2021-10-02',
      notes: '',
      deleted_at: null,
    }),
    stamp({
      id: 'en_3',
      event_id: 'ev_2021_wedding',
      contact_id: 'c_lina',
      direction: 'receive' as const,
      amount_cents: 40000,
      gift_kind: 'cash' as const,
      method: '微信' as const,
      handler: '我',
      happened_on: '2021-10-02',
      notes: '人没来，微信转的。',
      deleted_at: null,
    }),

    /* --- 2023 张叔儿子结婚：我随出 800 --- */
    stamp({
      id: 'en_4',
      event_id: 'ev_2023_zhang',
      contact_id: 'c_zhang',
      direction: 'give' as const,
      amount_cents: 80000,
      gift_kind: 'cash' as const,
      method: '现金' as const,
      handler: '我和爸妈',
      happened_on: '2023-05-01',
      notes: '',
      deleted_at: null,
    }),

    /* --- 2024 张叔家乔迁：我随出 300（不同类，用于验证「同类优先」） --- */
    stamp({
      id: 'en_5',
      event_id: 'ev_2024_zhang_house',
      contact_id: 'c_zhang',
      direction: 'give' as const,
      amount_cents: 30000,
      gift_kind: 'both' as const,
      goods_desc: '一对花瓶',
      goods_value_cents: 20000,
      method: '现金' as const,
      handler: '我',
      happened_on: '2024-06-01',
      notes: '随了 300，另带一对花瓶。',
      deleted_at: null,
    }),

    /* --- 2024 李娜家满月：我随出 500 --- */
    stamp({
      id: 'en_6',
      event_id: 'ev_2024_lina',
      contact_id: 'c_lina',
      direction: 'give' as const,
      amount_cents: 50000,
      gift_kind: 'cash' as const,
      method: '微信' as const,
      handler: '我',
      happened_on: '2024-03-12',
      notes: '包了红包没吃饭。',
      deleted_at: null,
    }),

    /* --- 2025 王阿姨家乔迁：我随出 600 --- */
    stamp({
      id: 'en_7',
      event_id: 'ev_2025_wang',
      contact_id: 'c_wang',
      direction: 'give' as const,
      amount_cents: 60000,
      gift_kind: 'cash' as const,
      method: '现金' as const,
      handler: '我',
      happened_on: '2025-08-16',
      notes: '',
      deleted_at: null,
    }),

    /* --- 2026 赵强父亲白事：我随出 500 --- */
    stamp({
      id: 'en_8',
      event_id: 'ev_2026_zhao',
      contact_id: 'c_zhao',
      direction: 'give' as const,
      amount_cents: 50000,
      gift_kind: 'cash' as const,
      method: '转账' as const,
      handler: '托同学带',
      happened_on: '2026-02-08',
      notes: '只随礼未到场。',
      deleted_at: null,
    }),

    /* --- 陈老师：只有礼物，没有现金 --- */
    stamp({
      id: 'en_9',
      event_id: 'ev_2024_lina',
      contact_id: 'c_chen',
      direction: 'give' as const,
      amount_cents: 0,
      gift_kind: 'goods' as const,
      goods_desc: '茶叶一盒',
      goods_value_cents: 30000,
      method: '其他' as const,
      handler: '我',
      happened_on: '2024-09-10',
      notes: '教师节送的，没有人情往来。',
      deleted_at: null,
    }),
  ];

  return {
    schema: 1,
    household: {
      id: 'h_demo',
      name: '我家',
      created_at: CREATED,
    },
    contacts,
    events,
    entries,
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** 示例数据里出现的人名，供界面提示「以下为虚构数据」 */
export const SEED_NOTICE =
  '示例账本中的人名、金额、地点均为虚构，仅用于试用，与真实人物无关。';
