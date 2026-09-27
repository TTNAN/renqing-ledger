/**
 * 人情账 · 领域类型
 *
 * 这里定义的是「业务语言」，不是数据库表。
 * 命名一律用中国人记账时会说的词：场次、户头、随出、收来。
 * 金额一律是整数分（amount_cents），绝不出现浮点人民币。
 */

/** 场次类型。数组顺序即界面展示顺序。 */
export const EVENT_TYPES = [
  '结婚',
  '满月',
  '百日',
  '周岁',
  '生日寿宴',
  '乔迁',
  '开业',
  '升学',
  '金榜',
  '探病',
  '白事',
  '节日',
  '其他',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** 白事相关的类型：界面降饱和、还礼走独立规则 */
export const SOMBRE_TYPES: readonly EventType[] = ['白事', '探病'];

export function isSombre(type: EventType): boolean {
  return SOMBRE_TYPES.includes(type);
}

/** 对方与我的关系 */
export const RELATIONS = ['亲戚', '朋友', '同事', '同学', '邻居', '领导', '其他'] as const;
export type Relation = (typeof RELATIONS)[number];

/** 随礼方式 */
export const METHODS = ['现金', '转账', '红包', '微信', '支付宝', '其他'] as const;
export type Method = (typeof METHODS)[number];

/** 往来方向：随出（我给对方） / 收来（对方给我） */
export type Direction = 'give' | 'receive';

/** 礼的形态 */
export type GiftKind = 'cash' | 'goods' | 'both';

/** 场次东道主：我家办事 / 对方家办事 */
export type HostSide = 'self' | 'other';

/** 本账本所属家庭（一般只有一条） */
export interface Household {
  id: string;
  name: string;
  created_at: string;
}

/** 对方户头：以「一户人家」为单位，不是通讯录碎片 */
export interface Contact {
  id: string;
  /** 称呼，如「张叔」「李家」 */
  display_name: string;
  /** 真实姓名，可选 */
  legal_name?: string;
  /** 别名，如「三舅」「张建国」。搜索时一并命中 */
  aliases: string[];
  relation: Relation;
  /** 所属家庭 / 分支，如「妈妈这边」「同事组」 */
  clan_or_branch?: string;
  phone?: string;
  notes?: string;
  archived?: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** 场次：一次红白喜事 */
export interface Event {
  id: string;
  title: string;
  type: EventType;
  /** YYYY-MM-DD */
  date: string;
  host_side: HostSide;
  /** 对方主办时指向户头 */
  host_contact_id?: string | null;
  location?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** 账目条目：一次具体的礼金往来 */
export interface Entry {
  id: string;
  event_id: string;
  contact_id: string;
  direction: Direction;
  /** 现金部分，整数分。礼物不计入这里 */
  amount_cents: number;
  gift_kind: GiftKind;
  /** 礼物名，如「茅台一瓶」 */
  goods_desc?: string;
  /** 礼物估价，整数分。默认不参与还礼现金建议 */
  goods_value_cents?: number;
  method?: Method;
  /** 经手人：家里谁去的、谁收的 */
  handler?: string;
  /** YYYY-MM-DD，默认同场次日期 */
  happened_on: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** 取整档位 */
export type RoundTo = 50 | 100;

export interface Settings {
  currency: 'CNY';
  /** 还礼建议取整到多少 */
  round_to: RoundTo;
  /** 按年份上浮百分比，默认 0 */
  uplift_percent: number;
  /** 白事模式：conservative = 只给历史参考，不自动加码 */
  funeral_mode: 'conservative';
  /** 字号倍率，1 = 标准，1.25 = 大字号 */
  font_scale: number;
  /** 是否启用应用锁 */
  password_enabled: boolean;
  /** 建议区间是否允许低于历史最低（白事默认不允许） */
  allow_below_history: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  currency: 'CNY',
  round_to: 100,
  uplift_percent: 0,
  funeral_mode: 'conservative',
  font_scale: 1,
  password_enabled: false,
  allow_below_history: false,
};

/** 整个账本 = 一个文档。备份、加密、恢复都针对它整体进行。 */
export interface LedgerData {
  schema: 1;
  household: Household;
  contacts: Contact[];
  events: Event[];
  entries: Entry[];
  settings: Settings;
}

/** 备份文件的信封格式 */
export interface BackupEnvelope {
  app: 'renqing-ledger';
  schema: 1;
  exported_at: string;
  /** 是否加密 */
  encrypted: boolean;
  /** 未加密时是 LedgerData；加密时是 base64 密文 */
  payload: LedgerData | string;
  /** 加密参数 */
  kdf?: {
    algo: 'argon2id';
    salt: string;
    iterations: number;
    memoryKiB: number;
    parallelism: number;
  };
  /** 明文的校验信息，便于给出「密码错误」而不是「文件损坏」 */
  hint?: string;
}

/* ------------------------------------------------------------------ 展示用映射 */

export const DIRECTION_LABEL: Record<Direction, string> = {
  give: '随出',
  receive: '收来',
};

export const GIFT_KIND_LABEL: Record<GiftKind, string> = {
  cash: '礼金',
  goods: '礼物',
  both: '礼金 + 礼物',
};

export const HOST_SIDE_LABEL: Record<HostSide, string> = {
  self: '我家办事',
  other: '对方家办事',
};
