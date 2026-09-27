/**
 * 人情账 · 平台适配层
 *
 * 同一套前端跑在三种容器里：
 *   browser  —— 浏览器 / 单文件 HTML / 本地服务器
 *   desktop  —— Electron（Windows 安装版）
 *   android  —— Capacitor（APK）
 *
 * 适配层只做三件事，业务代码完全不感知平台：
 *   1. 文件保存：桌面走「另存为」对话框，安卓走系统分享/文档目录，浏览器走下载
 *   2. 文件读取：桌面/安卓走原生文件选择器，浏览器走 <input type=file>
 *   3. 告诉界面「数据在哪」，好让设置页显示真实路径
 *
 * 设计原则：**降级永远可用**。
 * 原生桥不可用时一律回落到浏览器实现，所以 pnpm dev 的纯浏览器开发模式不受影响。
 */

import { Capacitor } from '@capacitor/core';

export type PlatformKind = 'browser' | 'desktop' | 'android';

/** 保存结果，用于给用户明确反馈 */
export interface SaveResult {
  ok: boolean;
  /** 用户可见的落点说明，例如「已保存到 文档/RenqingLedger」 */
  where?: string;
  /** 用户取消 */
  canceled?: boolean;
  error?: string;
}

export interface PickResult {
  name: string;
  text: string;
}

/** Electron 主进程通过 preload 暴露的桥 */
interface DesktopBridge {
  platform: 'desktop';
  saveFile(options: {
    filename: string;
    text: string;
    mime?: string;
  }): Promise<SaveResult>;
  saveBinary(options: {
    filename: string;
    data: Uint8Array;
    mime?: string;
  }): Promise<SaveResult>;
  openTextFile(options?: { accept?: string[] }): Promise<PickResult | null>;
  getPaths(): Promise<{
    userData: string;
    backups: string;
    ledgerFile: string;
  }>;
  setBackupDir(dir: string): Promise<{ ok: boolean; dir?: string; error?: string }>;
  pickDirectory(): Promise<string | null>;
  openPath(target: string): Promise<{ ok: boolean; error?: string }>;
  getVersion(): Promise<string>;
}

declare global {
  interface Window {
    renqingDesktop?: DesktopBridge;
  }
}

/* ------------------------------------------------------------------ 平台判定 */

let cached: PlatformKind | null = null;

export function platform(): PlatformKind {
  if (cached) return cached;

  if (typeof window !== 'undefined' && window.renqingDesktop) {
    cached = 'desktop';
    return cached;
  }

  try {
    if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
      cached = 'android';
      return cached;
    }
  } catch {
    /* Capacitor 未注入，按浏览器处理 */
  }

  cached = 'browser';
  return cached;
}

export const isDesktop = (): boolean => platform() === 'desktop';
export const isAndroid = (): boolean => platform() === 'android';
export const isBrowser = (): boolean => platform() === 'browser';

/* -------------------------------------------------------------- 平台化文案 */

/**
 * 按平台给文案。
 *
 * 为什么不各处写三目运算符：
 *   「这台电脑」/「这台手机」这种说法散落在顶栏、首页、底部多处，
 *   每处各写一遍容易漏改（安卓版曾漏掉首页那处，仍写着「电脑」）。
 *   统一收在这里，以后加平台只改一个地方。
 *
 * 用词口径：
 *   - 安卓 →「手机」，且不提 U 盘（手机一般不插 U 盘）
 *   - 桌面 →「电脑」
 *   - 浏览器 →「浏览器」，不假设设备类型
 */
export function deviceWord(): string {
  if (isAndroid()) return '手机';
  if (isDesktop()) return '电脑';
  return '浏览器';
}

/** 「数据只存在这台电脑上。」这类句子里的称呼 */
export function thisDevice(): string {
  return `这台${deviceWord()}`;
}

/** 备份该存到哪：手机不提 U 盘 */
export function backupTarget(): string {
  return isAndroid() ? '存到手机文件夹，或直接分享给别人' : '存到 U 盘或自己的网盘';
}

/** 换设备前的提醒 */
export function migrateHint(): string {
  return isAndroid()
    ? '卸载应用会一起删掉账本，卸载前请先导出备份。'
    : isBrowser()
      ? '换浏览器、清理浏览器数据或换设备前，请先导出备份。'
      : '换电脑或重装系统前，请先导出备份。';
}

/** 卸载/清理的后果说明（安卓专用，其他平台为空） */
export function uninstallWarning(): string {
  return isAndroid() ? '卸载应用会一起删掉账本。' : '';
}

/**
 * 连续录入的操作提示。
 *
 * 桌面有实体回车键，一路回车就能连录；
 * 手机软键盘各品牌不一，不能假设一定有回车，
 * 所以改成指引那个必然存在的「保存并继续」按钮。
 */
export function quickAddHint(): string {
  return isAndroid()
    ? '选场次 → 选对方 → 填金额 → 点「保存并继续」。可以一直录下去。'
    : '选场次 → 选对方 → 填金额 → 回车。可以一直录下去。';
}

/** 金额输入框下方的细则 */
export function quickAddSubHint(): string {
  return isAndroid()
    ? '填好金额后，点下面的「保存并继续」就能接着录下一笔。'
    : '按回车直接保存并继续录下一笔。';
}

/** 场次详情页没有条目时的提示 */
export function emptyEventHint(): string {
  return isAndroid()
    ? '点下面的按钮开始录，照礼簿一页页打，能一直录下去。'
    : '点下面的按钮开始录。照礼簿一页页打，回车就能一直录下去。';
}

/* ------------------------------------------------------------------ 文件名 */

/**
 * 备份文件名：renqing-backup-YYYYMMDD-HHmm.json
 * 需求里点名的格式，两端统一。
 */
export function backupFileName(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`;
  return `renqing-backup-${stamp}.json`;
}

/** 导出的表格文件名 */
export function tableFileName(base: string, ext: string, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`;
  const safe = base.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  return `${safe}-${stamp}.${ext}`;
}

/* ------------------------------------------------------------------ 保存文件 */

/** 浏览器兜底：Blob 下载 */
function browserDownload(filename: string, text: string, mime: string): SaveResult {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, where: '已下载到浏览器的下载目录' };
}

/**
 * 保存文本到文件。
 *   desktop —— 系统「另存为」对话框
 *   android —— 写入 Documents/RenqingLedger/，失败则退回系统分享
 *   browser —— Blob 下载
 */
export async function saveTextFile(
  filename: string,
  text: string,
  mime = 'application/json',
): Promise<SaveResult> {
  const kind = platform();

  if (kind === 'desktop') {
    try {
      return await window.renqingDesktop!.saveFile({ filename, text, mime });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '保存失败' };
    }
  }

  if (kind === 'android') {
    try {
      const { saveToDocuments } = await import('./androidFiles');
      return await saveToDocuments(filename, text, mime);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '保存失败' };
    }
  }

  return browserDownload(filename, text, mime);
}

/** 保存二进制（生成 PDF 用） */
export async function saveBinaryFile(
  filename: string,
  data: Uint8Array,
  mime = 'application/pdf',
): Promise<SaveResult> {
  const kind = platform();

  if (kind === 'desktop') {
    try {
      return await window.renqingDesktop!.saveBinary({ filename, data, mime });
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '保存失败' };
    }
  }

  if (kind === 'android') {
    try {
      const { saveBinaryToDocuments } = await import('./androidFiles');
      return await saveBinaryToDocuments(filename, data, mime);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '保存失败' };
    }
  }

  // 浏览器
  const blob = new Blob([data as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true, where: '已下载' };
}

/* ------------------------------------------------------------------ 读取文件 */

/** 浏览器兜底：<input type=file> */
function browserPickFile(accept: string): Promise<PickResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';

    let settled = false;
    const done = (v: PickResult | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        done(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => done({ name: file.name, text: String(reader.result ?? '') });
      reader.onerror = () => done(null);
      reader.readAsText(file, 'utf-8');
    };

    // 用户直接关掉选择框时不会触发 change，靠窗口重新获得焦点兜底
    window.addEventListener(
      'focus',
      () => {
        setTimeout(() => {
          if (!settled && (!input.files || input.files.length === 0)) done(null);
        }, 400);
      },
      { once: true },
    );

    document.body.appendChild(input);
    input.click();
  });
}

/**
 * 让用户选一个文本文件读进来。
 *   desktop —— 原生打开对话框
 *   android —— 系统文件选择器（SAF，兼容 Android 15 分区存储）
 *   browser —— <input type=file>
 */
export async function pickTextFile(
  accept: string[] = ['.json', 'application/json'],
): Promise<PickResult | null> {
  const kind = platform();

  if (kind === 'desktop') {
    try {
      return await window.renqingDesktop!.openTextFile({ accept });
    } catch {
      return null;
    }
  }

  if (kind === 'android') {
    try {
      const { pickJsonFile } = await import('./androidFiles');
      return await pickJsonFile();
    } catch {
      return null;
    }
  }

  return browserPickFile(accept.join(','));
}

/* ------------------------------------------------------------------ 数据在哪 */

export interface DataLocation {
  /** 主数据存放说明（给用户看的大白话） */
  primary: string;
  /** 备份目录（桌面有真实路径，安卓是「文档」下的位置） */
  backups: string;
  /** 精确路径，仅桌面端有；安卓/浏览器为空 */
  exact?: string;
  /** 是否能在文件管理器里打开 */
  canOpen: boolean;
}

/** 缓存起来，避免设置页每次渲染都问一次主进程 */
let locationCache: DataLocation | null = null;

export async function getDataLocation(): Promise<DataLocation> {
  if (locationCache) return locationCache;

  const kind = platform();

  if (kind === 'desktop') {
    try {
      const p = await window.renqingDesktop!.getPaths();
      locationCache = {
        primary: '本机用户数据目录（不会被写进安装目录）',
        backups: p.backups,
        exact: p.userData,
        canOpen: true,
      };
      return locationCache;
    } catch {
      /* 落到默认 */
    }
  }

  if (kind === 'android') {
    locationCache = {
      primary: '本应用私有目录（其他应用读不到，卸载即删除）',
      backups: '文档/RenqingLedger',
      canOpen: false,
    };
    return locationCache;
  }

  locationCache = {
    primary: '这个浏览器的本地存储（IndexedDB）',
    backups: '浏览器的下载目录',
    canOpen: false,
  };
  return locationCache;
}

/** 桌面端：在文件管理器里打开数据目录 */
export async function revealDataFolder(): Promise<boolean> {
  if (!isDesktop()) return false;
  try {
    const p = await window.renqingDesktop!.getPaths();
    const r = await window.renqingDesktop!.openPath(p.userData);
    return r.ok;
  } catch {
    return false;
  }
}

/** 桌面端：让用户改备份目录 */
export async function chooseBackupDir(): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const dir = await window.renqingDesktop!.pickDirectory();
    if (!dir) return null;
    const r = await window.renqingDesktop!.setBackupDir(dir);
    locationCache = null; // 路径变了，缓存作废
    return r.ok ? (r.dir ?? dir) : null;
  } catch {
    return null;
  }
}

/** 桌面端版本号（用于设置页展示） */
export async function appVersion(): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    return await window.renqingDesktop!.getVersion();
  } catch {
    return null;
  }
}

/** 触发一次系统分享（安卓） */
export async function shareText(filename: string, text: string): Promise<SaveResult> {
  if (!isAndroid()) {
    return saveTextFile(filename, text, 'application/json');
  }
  try {
    const { shareJson } = await import('./androidFiles');
    return await shareJson(filename, text);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '分享失败' };
  }
}
