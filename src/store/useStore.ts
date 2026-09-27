/**
 * 人情账 · 全局状态
 *
 * 一个 store 管所有事：账本数据 + 界面开关 + 落盘。
 * 所有写操作都走这里的 action，改完立刻 persist()，
 * 这样「记一笔」永远是「回车 → 存好了」，不会丢。
 *
 * 注意：密码只存在内存里（this.password），刷新页面就要重新输入。
 */

import { create } from 'zustand';
import type { Contact, Entry, Event, LedgerData, Settings } from '@/domain/types';
import { DEFAULT_SETTINGS } from '@/domain/types';
import { todayISO } from '@/domain/date';
import * as repo from '@/storage/repo';
import { buildSeedLedger } from '@/storage/seed';
import { autoBackup } from '@/storage/repo';

export type Screen =
  | { name: 'home' }
  | { name: 'quick-add'; eventId?: string }
  | { name: 'suggest'; contactId?: string }
  | { name: 'contacts' }
  | { name: 'contact'; id: string }
  | { name: 'events' }
  | { name: 'event'; id: string }
  | { name: 'stats' }
  | { name: 'settings' }
  | { name: 'backup' };

export interface ToastMessage {
  id: string;
  text: string;
  tone: 'ok' | 'warn' | 'error';
}

interface State {
  /* 数据 */
  ledger: LedgerData | null;
  /** 载入中 */
  loading: boolean;
  /** 需要解锁 */
  locked: boolean;
  /** 内存里的密码，用于加密保存。绝不落盘。 */
  password: string | null;
  /** 数据库里是否启用了加密 */
  encrypted: boolean;

  /* 界面 */
  screen: Screen;
  toasts: ToastMessage[];

  /* 生命周期 */
  boot: () => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;

  /* 导航 */
  go: (screen: Screen) => void;
  toast: (text: string, tone?: ToastMessage['tone']) => void;
  dismissToast: (id: string) => void;

  /* 数据操作 */
  setHouseholdName: (name: string) => void;
  updateSettings: (patch: Partial<Settings>) => void;

  addContact: (input: Partial<Contact> & { display_name: string }) => Contact;
  updateContact: (id: string, patch: Partial<Contact>) => void;
  deleteContact: (id: string) => void;
  archiveContact: (id: string, archived: boolean) => void;
  mergeContacts: (fromId: string, intoId: string) => void;

  addEvent: (input: Partial<Event> & { title: string; type: Event['type']; date: string }) => Event;
  updateEvent: (id: string, patch: Partial<Event>) => void;
  deleteEvent: (id: string) => void;

  addEntry: (input: Partial<Entry> & { event_id: string; contact_id: string; amount_cents: number }) => Entry;
  updateEntry: (id: string, patch: Partial<Entry>) => void;
  deleteEntry: (id: string) => void;

  loadSeed: () => Promise<void>;
  replaceLedger: (data: LedgerData) => Promise<void>;
  wipe: () => Promise<void>;

  /* 备份 */
  runAutoBackup: () => Promise<void>;
}

/** 找或建一个「临时一场」，用于「记一笔」时懒得先建场次 */
export function temporaryEventTitle(date: string, contactName: string, type: string): string {
  return `${date.slice(0, 4)}-${date.slice(5, 7)}-${date.slice(8, 10)} ${contactName}${type}`;
}

export const useStore = create<State>((set, get) => {
  /** 把当前账本写回本地。任何数据改动之后都要调。 */
  async function persist(next?: LedgerData): Promise<void> {
    const ledger = next ?? get().ledger;
    if (!ledger) return;
    const password = get().password;
    try {
      await repo.saveLedger(ledger, password ?? undefined);
    } catch (err) {
      get().toast(
        '保存失败：' + (err instanceof Error ? err.message : '未知错误'),
        'error',
      );
    }
  }

  /** 改数据 + 落盘的统一入口 */
  function mutate(fn: (draft: LedgerData) => void): void {
    const cur = get().ledger;
    if (!cur) return;
    // 浅拷贝外层，内层数组由 fn 自行替换
    const draft: LedgerData = {
      ...cur,
      contacts: cur.contacts.slice(),
      events: cur.events.slice(),
      entries: cur.entries.slice(),
      settings: { ...cur.settings },
    };
    fn(draft);
    set({ ledger: draft });
    void persist(draft);
  }

  return {
    ledger: null,
    loading: true,
    locked: false,
    password: null,
    encrypted: false,
    screen: { name: 'home' },
    toasts: [],

    async boot() {
      set({ loading: true });
      try {
        const encrypted = await repo.isEncrypted();
        if (encrypted) {
          set({ encrypted: true, locked: true, loading: false });
          return;
        }

        const data = await repo.loadLedger();

        /**
         * 首次打开时本地还没有账本，loadLedger() 返回 null。
         *
         * 这里**不能把 null 存进 state** —— 那会让所有页面各自处理空值，
         * 漏掉一个就整页空白（「记一笔」曾经就是这样：点进去什么都没有）。
         * 所以统一在这里兜底成一个空账本，页面永远拿到可用的数据结构。
         *
         * 注意：兜底的空账本**不写盘**，用户没记东西就不该产生文件。
         * 真正的落盘发生在第一次 addEntry / loadSeed。
         */
        set({
          ledger: data ?? repo.emptyLedger(),
          encrypted: false,
          locked: false,
          loading: false,
        });
      } catch {
        // 读盘失败也要给一个能用的空账本，而不是 null
        set({ ledger: repo.emptyLedger(), loading: false });
      }
    },

    async unlock(password) {
      try {
        const data = await repo.loadLedger(password);
        // 解密成功但内容为空，同样兜底成空账本
        set({
          ledger: data ?? repo.emptyLedger(),
          password,
          locked: false,
          encrypted: true,
        });
        // 解锁成功后跑一次自动备份
        void get().runAutoBackup();
        return true;
      } catch {
        return false;
      }
    },

    lock() {
      set({ password: null, ledger: null, locked: true, screen: { name: 'home' } });
    },

    go(screen) {
      set({ screen });
      if (typeof window !== 'undefined') window.scrollTo(0, 0);
    },

    toast(text, tone = 'ok') {
      const id = Math.random().toString(36).slice(2);
      set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
      setTimeout(() => get().dismissToast(id), 3200);
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    },

    /* ---------------------------------------------------------- 户头 */

    addContact(input) {
      const now = repo.nowISO();
      const contact: Contact = {
        id: repo.uid('c_'),
        display_name: input.display_name.trim() || '未命名',
        legal_name: input.legal_name,
        aliases: input.aliases ?? [],
        relation: input.relation ?? '其他',
        clan_or_branch: input.clan_or_branch,
        phone: input.phone,
        notes: input.notes,
        archived: false,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      mutate((d) => {
        d.contacts.push(contact);
      });
      return contact;
    },

    updateContact(id, patch) {
      mutate((d) => {
        const i = d.contacts.findIndex((c) => c.id === id);
        if (i < 0) return;
        d.contacts[i] = { ...d.contacts[i]!, ...patch, updated_at: repo.nowISO() };
      });
    },

    deleteContact(id) {
      // 软删除：保留历史，统计里自动排除
      mutate((d) => {
        const i = d.contacts.findIndex((c) => c.id === id);
        if (i < 0) return;
        d.contacts[i] = { ...d.contacts[i]!, deleted_at: repo.nowISO() };
      });
    },

    archiveContact(id, archived) {
      mutate((d) => {
        const i = d.contacts.findIndex((c) => c.id === id);
        if (i < 0) return;
        d.contacts[i] = { ...d.contacts[i]!, archived, updated_at: repo.nowISO() };
      });
    },

    mergeContacts(fromId, intoId) {
      if (fromId === intoId) return;
      mutate((d) => {
        const from = d.contacts.find((c) => c.id === fromId);
        const into = d.contacts.find((c) => c.id === intoId);
        if (!from || !into) return;

        // 别名合并，顺便把对方的称呼也变成别名，历史查询不会断
        const aliases = new Set([
          ...(into.aliases ?? []),
          ...(from.aliases ?? []),
          from.display_name,
        ]);
        aliases.delete(into.display_name);

        d.contacts = d.contacts.map((c) =>
          c.id === intoId
            ? { ...c, aliases: [...aliases], updated_at: repo.nowISO() }
            : c,
        );

        // 所有条目改挂到目标户头
        d.entries = d.entries.map((e) =>
          e.contact_id === fromId ? { ...e, contact_id: intoId, updated_at: repo.nowISO() } : e,
        );

        // 场次的东道主也改
        d.events = d.events.map((ev) =>
          ev.host_contact_id === fromId ? { ...ev, host_contact_id: intoId } : ev,
        );

        // 来源户头软删除
        d.contacts = d.contacts.map((c) =>
          c.id === fromId ? { ...c, deleted_at: repo.nowISO() } : c,
        );
      });
    },

    /* ---------------------------------------------------------- 场次 */

    addEvent(input) {
      const now = repo.nowISO();
      const event: Event = {
        id: repo.uid('ev_'),
        title: input.title.trim() || '未命名场次',
        type: input.type,
        date: input.date,
        host_side: input.host_side ?? 'other',
        host_contact_id: input.host_contact_id ?? null,
        location: input.location,
        notes: input.notes,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      mutate((d) => {
        d.events.push(event);
      });
      return event;
    },

    updateEvent(id, patch) {
      mutate((d) => {
        const i = d.events.findIndex((e) => e.id === id);
        if (i < 0) return;
        d.events[i] = { ...d.events[i]!, ...patch, updated_at: repo.nowISO() };
      });
    },

    deleteEvent(id) {
      // 场次软删除，连带它的条目也软删除
      mutate((d) => {
        const now = repo.nowISO();
        const i = d.events.findIndex((e) => e.id === id);
        if (i >= 0) d.events[i] = { ...d.events[i]!, deleted_at: now };
        d.entries = d.entries.map((e) =>
          e.event_id === id ? { ...e, deleted_at: now } : e,
        );
      });
    },

    /* ---------------------------------------------------------- 条目 */

    addEntry(input) {
      const now = repo.nowISO();
      const entry: Entry = {
        id: repo.uid('en_'),
        event_id: input.event_id,
        contact_id: input.contact_id,
        direction: input.direction ?? 'give',
        amount_cents: Math.max(0, Math.round(input.amount_cents)),
        gift_kind: input.gift_kind ?? 'cash',
        goods_desc: input.goods_desc,
        goods_value_cents: input.goods_value_cents,
        method: input.method,
        handler: input.handler,
        happened_on: input.happened_on ?? todayISO(),
        notes: input.notes,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };
      mutate((d) => {
        d.entries.push(entry);
      });
      return entry;
    },

    updateEntry(id, patch) {
      mutate((d) => {
        const i = d.entries.findIndex((e) => e.id === id);
        if (i < 0) return;
        d.entries[i] = { ...d.entries[i]!, ...patch, updated_at: repo.nowISO() };
      });
    },

    deleteEntry(id) {
      mutate((d) => {
        const i = d.entries.findIndex((e) => e.id === id);
        if (i < 0) return;
        d.entries[i] = { ...d.entries[i]!, deleted_at: repo.nowISO() };
      });
    },

    /* ---------------------------------------------------------- 整库 */

    async loadSeed() {
      const data = buildSeedLedger();
      set({ ledger: data });
      await persist(data);
      get().toast('示例账本已载入，人名金额均为虚构');
    },

    async replaceLedger(data) {
      set({ ledger: data });
      await persist(data);
    },

    async wipe() {
      await repo.wipeAll();
      // 同样兜底成空账本，而不是 null —— 否则清空后所有页面又会变空白
      set({
        ledger: repo.emptyLedger(),
        password: null,
        encrypted: false,
        locked: false,
      });
      get().toast('已清空本机全部数据');
    },

    /* ---------------------------------------------------------- 设置 */

    setHouseholdName(name) {
      mutate((d) => {
        d.household = { ...d.household, name: name.trim() || '我家' };
      });
    },

    updateSettings(patch) {
      mutate((d) => {
        d.settings = { ...DEFAULT_SETTINGS, ...d.settings, ...patch };
      });
    },

    /* ---------------------------------------------------------- 备份 */

    async runAutoBackup() {
      const ledger = get().ledger;
      if (!ledger) return;
      try {
        await autoBackup(ledger, get().password ?? undefined);
      } catch {
        // 备份失败不该打断使用
      }
    },
  };
});

/* ------------------------------------------------------------------ 选择器 */

export function useLedger(): LedgerData | null {
  return useStore((s) => s.ledger);
}

/**
 * 账本是不是「还什么都没记」。
 *
 * 首页靠这个决定要不要显示「载入示例 / 记第一笔」的引导。
 * 注意不能用 `!ledger` 判断 —— boot 之后 ledger 一定存在（可能是空的）。
 */
export function isEmptyLedger(data: LedgerData | null | undefined): boolean {
  if (!data) return true;
  const hasContact = data.contacts.some((c) => !c.deleted_at);
  const hasEvent = data.events.some((e) => !e.deleted_at);
  const hasEntry = data.entries.some((e) => !e.deleted_at);
  return !hasContact && !hasEvent && !hasEntry;
}

/** 未删除的户头 */
export function useContacts(): Contact[] {
  return useStore((s) => s.ledger?.contacts.filter((c) => !c.deleted_at) ?? []);
}

/** 未删除的场次，按日期倒序 */
export function useEvents(): Event[] {
  const events = useStore((s) => s.ledger?.events);
  return (events ?? [])
    .filter((e) => !e.deleted_at)
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** 未删除的条目 */
export function useEntries(): Entry[] {
  return useStore((s) => s.ledger?.entries.filter((e) => !e.deleted_at) ?? []);
}

export function useSettings(): Settings {
  return useStore((s) => s.ledger?.settings ?? DEFAULT_SETTINGS);
}
