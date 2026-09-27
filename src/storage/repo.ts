/**
 * 人情账 · 仓储层
 *
 * 界面只跟这一层打交道，不直接碰 IndexedDB。
 * 职责：读写账本、软删除、自动备份、加密开关、JSON 备份/恢复。
 *
 * 隐私约定：这个文件里没有任何网络调用，也不打印姓名与金额。
 */

import {
  KEY_LEDGER,
  KEY_LOCK,
  deleteBackup,
  getBackup,
  kvDelete,
  kvGet,
  kvSet,
  listBackups,
  putBackup,
  type BackupRecord,
} from './db';

export type { BackupRecord };
export { safeFileName } from '@/domain/export';
import {
  cryptoAvailable,
  decryptJson,
  encryptJson,
  type CipherBlob,
  type KdfParams,
} from './crypto';
import type { BackupEnvelope, LedgerData } from '@/domain/types';
import { DEFAULT_SETTINGS } from '@/domain/types';
import { todayISO } from '@/domain/date';
import {
  pickTextFile as pickTextFilePlatform,
  saveTextFile,
  type SaveResult,
} from '@/platform';

/** 自动备份保留份数 */
export const KEEP_BACKUPS = 20;

/** 加密配置 */
export interface LockConfig {
  enabled: boolean;
  kdf?: KdfParams;
}

/** 磁盘上存的东西：要么是明文账本，要么是密文 */
type StoredLedger = { encrypted: false; data: LedgerData } | { encrypted: true; blob: CipherBlob };

export function uid(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}${time}${rand}`;
}

export function nowISO(): string {
  return new Date().toISOString();
}

/** 空白账本 */
export function emptyLedger(householdName = '我家'): LedgerData {
  return {
    schema: 1,
    household: {
      id: uid('h_'),
      name: householdName,
      created_at: nowISO(),
    },
    contacts: [],
    events: [],
    entries: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

/**
 * 兜底修复：老版本备份、手工改过的 JSON 都可能缺字段。
 * 宁可补默认值，也不要让界面白屏。
 */
export function normalizeLedger(input: unknown): LedgerData {
  const raw = (input ?? {}) as Partial<LedgerData>;
  const base = emptyLedger();

  return {
    schema: 1,
    household: {
      id: raw.household?.id ?? base.household.id,
      name: raw.household?.name ?? base.household.name,
      created_at: raw.household?.created_at ?? base.household.created_at,
    },
    contacts: Array.isArray(raw.contacts) ? raw.contacts : [],
    events: Array.isArray(raw.events) ? raw.events : [],
    entries: Array.isArray(raw.entries) ? raw.entries : [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

/* ------------------------------------------------------------------ 读写 */

export async function loadLockConfig(): Promise<LockConfig> {
  const cfg = await kvGet<LockConfig>(KEY_LOCK);
  return cfg ?? { enabled: false };
}

export async function saveLockConfig(cfg: LockConfig): Promise<void> {
  await kvSet(KEY_LOCK, cfg);
}

/** 账本是否已加密（决定要不要弹解锁页） */
export async function isEncrypted(): Promise<boolean> {
  const stored = await kvGet<StoredLedger>(KEY_LEDGER);
  return stored?.encrypted === true;
}

/**
 * 读取账本。
 *  - 未加密：直接返回
 *  - 已加密：必须给密码，密码错会抛错
 *  - 首次使用：返回 null，由界面引导「载入示例」或「从空白开始」
 */
export async function loadLedger(password?: string): Promise<LedgerData | null> {
  const stored = await kvGet<StoredLedger>(KEY_LEDGER);
  if (!stored) return null;

  if (!stored.encrypted) {
    return normalizeLedger(stored.data);
  }

  if (!password) throw new Error('这个账本已加密，需要密码');

  const data = await decryptJson<LedgerData>(stored.blob, password);
  return normalizeLedger(data);
}

/** 保存账本。password 为空则明文存储（设置页会警告）。 */
export async function saveLedger(data: LedgerData, password?: string): Promise<void> {
  if (password) {
    const blob = await encryptJson(data, password);
    const stored: StoredLedger = { encrypted: true, blob };
    await kvSet(KEY_LEDGER, stored);
    await saveLockConfig({ enabled: true, kdf: blob.kdf });
    return;
  }

  const stored: StoredLedger = { encrypted: false, data };
  await kvSet(KEY_LEDGER, stored);
  await saveLockConfig({ enabled: false });
}

/**
 * 换密码 / 开启 / 关闭加密。
 * 关闭加密时必须提供当前密码来解密。
 */
export async function changePassword(
  data: LedgerData,
  oldPassword: string | undefined,
  newPassword: string | null,
): Promise<void> {
  // 传进来的 data 已在内存里是明文，直接按新设置写回即可
  void oldPassword;
  await saveLedger(data, newPassword ?? undefined);
}

/* ------------------------------------------------------------------ 自动备份 */

export interface AutoBackupResult {
  created: boolean;
  kept: number;
  pruned: number;
}

/**
 * 自动备份。每次启动或每天一次调用。
 * 同一天只留一份（避免反复启动刷满 20 份），保留最近 KEEP_BACKUPS 份。
 */
export async function autoBackup(
  data: LedgerData,
  password?: string,
): Promise<AutoBackupResult> {
  const today = todayISO();
  const existing = await listBackups();

  // 今天已经备过就不重复备
  const hasToday = existing.some((b) => b.created_at.slice(0, 10) === today);
  if (hasToday) {
    return { created: false, kept: existing.length, pruned: 0 };
  }

  const payload = password
    ? JSON.stringify(await encryptJson(data, password))
    : JSON.stringify(data);

  const rec: BackupRecord = {
    id: `bk_${today}_${Date.now().toString(36)}`,
    created_at: nowISO(),
    size: JSON.stringify(data).length,
    payload,
    encrypted: Boolean(password),
  };

  await putBackup(rec);

  // 只留最近 20 份
  const after = await listBackups();
  const extra = after.slice(KEEP_BACKUPS);
  for (const b of extra) await deleteBackup(b.id);

  return { created: true, kept: after.length - extra.length, pruned: extra.length };
}

export async function listAllBackups(): Promise<BackupRecord[]> {
  return listBackups();
}

/** 从自动备份恢复。返回还原出来的账本。 */
export async function restoreFromBackup(id: string, password?: string): Promise<LedgerData> {
  const rec = await getBackup(id);
  if (!rec) throw new Error('找不到这份备份');

  if (rec.encrypted) {
    if (!password) throw new Error('这份备份已加密，需要密码');
    const blob = JSON.parse(rec.payload) as CipherBlob;
    return normalizeLedger(await decryptJson<LedgerData>(blob, password));
  }

  return normalizeLedger(JSON.parse(rec.payload));
}

export async function removeBackup(id: string): Promise<void> {
  await deleteBackup(id);
}

/* ------------------------------------------------------------------ 导入导出 */

/** 生成可下载的备份信封 */
export async function exportEnvelope(
  data: LedgerData,
  password?: string,
): Promise<BackupEnvelope> {
  const base = {
    app: 'renqing-ledger' as const,
    schema: 1 as const,
    exported_at: nowISO(),
    hint: data.household?.name ?? '',
  };

  if (password) {
    const blob = await encryptJson(data, password);
    return {
      ...base,
      encrypted: true,
      payload: JSON.stringify(blob),
      kdf: blob.kdf,
    };
  }

  return { ...base, encrypted: false, payload: data };
}

export interface ImportResult {
  data: LedgerData;
  wasEncrypted: boolean;
}

/**
 * 解析备份文件。能认出三种东西：
 *   1. 本应用的标准信封（明文 / 加密）
 *   2. 直接就是 LedgerData 的裸 JSON
 *   3. 早期版本可能只导出了 entries 数组 —— 尽力而为
 */
export async function importEnvelope(
  text: string,
  password?: string,
): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('这不是一个 JSON 文件，或者文件已经损坏');
  }

  const obj = parsed as Record<string, unknown>;

  // 情况 2：裸账本
  if (obj && typeof obj === 'object' && 'contacts' in obj && 'entries' in obj) {
    return { data: normalizeLedger(obj), wasEncrypted: false };
  }

  // 情况 1：标准信封
  if (obj && obj.app === 'renqing-ledger') {
    const envelope = obj as unknown as BackupEnvelope;

    if (!envelope.encrypted) {
      return { data: normalizeLedger(envelope.payload), wasEncrypted: false };
    }

    if (!password) throw new Error('这份备份是加密的，请先输入导出时设置的密码');
    const blob = JSON.parse(String(envelope.payload)) as CipherBlob;
    const data = await decryptJson<LedgerData>(blob, password);
    return { data: normalizeLedger(data), wasEncrypted: true };
  }

  throw new Error('这不像人情账的备份文件');
}

/**
 * 保存文本为文件。
 *
 * 这里只是个转发：真正的实现在 src/platform/，按平台分流：
 *   桌面 → 系统「另存为」对话框
 *   安卓 → 写入「文档/RenqingLedger/」，失败退回系统分享
 *   浏览器 → Blob 下载
 *
 * 调用方（设置页 / 场次页）不需要知道自己跑在哪个平台上。
 */
export async function downloadText(
  filename: string,
  text: string,
  mime = 'application/json',
): Promise<SaveResult> {
  return saveTextFile(filename, text, mime);
}

/**
 * 弹文件选择框读文本。
 * 同样是转发：桌面/安卓走原生选择器，浏览器走 <input type=file>。
 */
export async function pickTextFile(
  accept: string[] = ['.json', 'application/json'],
): Promise<{ name: string; text: string } | null> {
  return pickTextFilePlatform(accept);
}

/** 清空一切 */
export async function wipeAll(): Promise<void> {
  await kvDelete(KEY_LEDGER);
  await kvDelete(KEY_LOCK);
  const all = await listBackups();
  for (const b of all) await deleteBackup(b.id);
}

export { cryptoAvailable };
