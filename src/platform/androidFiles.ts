/**
 * 人情账 · Android 文件读写
 *
 * 安卓上没有 C:\ 这种随意路径，必须走系统给的口子。这里用两条路：
 *
 *   导出 → Filesystem.writeFile 到 Documents/RenqingLedger/
 *          （Capacitor 会走 MediaStore / SAF，Android 15 分区存储下依然可用，
 *            且不需要申请任何存储权限）
 *          万一失败，退回系统分享面板，让用户自己选存到哪
 *
 *   导入 → 系统文件选择器（SAF），兼容 Android 15 的分区存储
 *
 * 这个模块只在安卓平台被动态 import，浏览器和桌面端不会加载它，
 * 所以 @capacitor/* 不会进 Web 包。
 */

import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export interface SaveOutcome {
  ok: boolean;
  where?: string;
  canceled?: boolean;
  error?: string;
}

export interface PickOutcome {
  name: string;
  text: string;
}

/** 导出目录名。用户在「文档」里能找到 */
const FOLDER = 'RenqingLedger';

/**
 * 把文本写到「文档/RenqingLedger/」。
 * 这是用户能用系统「文件」App 找到的地方，卸载应用也不会被删。
 */
export async function saveToDocuments(
  filename: string,
  text: string,
  mime = 'application/json',
): Promise<SaveOutcome> {
  void mime;
  // 先确保目录存在（已存在会抛错，忽略即可）
  try {
    await Filesystem.mkdir({
      path: FOLDER,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    /* 目录已存在 */
  }

  try {
    await Filesystem.writeFile({
      path: `${FOLDER}/${filename}`,
      data: text,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    });

    return {
      ok: true,
      where: `已保存到「文档/${FOLDER}/${filename}」。可以用系统「文件」App 找到，再拷到电脑。`,
    };
  } catch (e) {
    // 写不进去（某些机型对 Documents 有限制）→ 退回分享面板
    try {
      return await shareJson(filename, text, mime);
    } catch {
      return {
        ok: false,
        error:
          '没能写入「文档」目录：' +
          (e instanceof Error ? e.message : '未知错误') +
          '。可以试试用系统分享保存。',
      };
    }
  }
}

/** 保存二进制（PDF） */
export async function saveBinaryToDocuments(
  filename: string,
  data: Uint8Array,
  mime = 'application/pdf',
): Promise<SaveOutcome> {
  void mime;
  // Capacitor Filesystem 接受 base64 字符串
  let base64 = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    base64 += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  base64 = btoa(base64);

  try {
    await Filesystem.mkdir({
      path: FOLDER,
      directory: Directory.Documents,
      recursive: true,
    });
  } catch {
    /* 已存在 */
  }

  try {
    await Filesystem.writeFile({
      path: `${FOLDER}/${filename}`,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });
    return { ok: true, where: `已保存到「文档/${FOLDER}/${filename}」` };
  } catch (e) {
    return {
      ok: false,
      error: '保存失败：' + (e instanceof Error ? e.message : '未知错误'),
    };
  }
}

/**
 * 走系统分享面板。用户可以选择「保存到文件」、发到微信、发到自己邮箱等。
 * 这是最通用的一条路 —— 不依赖任何目录约定。
 */
export async function shareJson(
  filename: string,
  text: string,
  mime = 'application/json',
): Promise<SaveOutcome> {
  void mime;
  // 先写到缓存目录，再把这个文件分享出去
  const cachePath = `share/${filename}`;
  try {
    await Filesystem.writeFile({
      path: cachePath,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
      recursive: true,
    });
  } catch (e) {
    return {
      ok: false,
      error: '准备分享文件失败：' + (e instanceof Error ? e.message : '未知错误'),
    };
  }

  let uri = '';
  try {
    const r = await Filesystem.getUri({
      path: cachePath,
      directory: Directory.Cache,
    });
    uri = r.uri;
  } catch {
    /* 没有 uri 也能试分享 */
  }

  try {
    await Share.share({
      title: '人情账备份',
      text: `人情账备份文件 ${filename}`,
      url: uri || undefined,
      dialogTitle: '保存或发送备份文件',
    });
    return { ok: true, where: '已通过系统分享面板处理' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    // 用户点了取消
    if (/cancel/i.test(msg)) return { ok: false, canceled: true };
    return { ok: false, error: '分享失败：' + msg };
  }
}

/**
 * 用系统文件选择器挑一个 JSON。
 * Capacitor 的 pickFiles 在 Android 上走 SAF，Android 15 分区存储也能用，
 * 且不需要 READ_EXTERNAL_STORAGE 权限。
 */
export async function pickJsonFile(): Promise<PickOutcome | null> {
  // pickFiles 在部分 Capacitor 版本里才有，做个兼容探测
  type PickFn = (opts: {
    limit?: number;
    types?: string[];
  }) => Promise<{ files: { uri: string; name?: string }[] }>;

  let pickFiles: PickFn | null = null;

  try {
    const mod = (await import('@capacitor/filesystem')) as unknown as Record<string, unknown>;
    const fn = mod['pickFiles'];
    if (typeof fn === 'function') {
      pickFiles = fn as unknown as PickFn;
    }
  } catch {
    /* 老版本没有 */
  }

  if (!pickFiles) {
    throw new Error(
      '这个版本的运行环境不支持系统文件选择器，请改用「从自动备份恢复」，或把备份文件放到「文档/RenqingLedger」后重试。',
    );
  }

  const res = await pickFiles({ limit: 1, types: ['application/json'] });
  const file = res?.files?.[0];
  if (!file) return null;

  // 选中的是 content:// 或 file:// URI，用 Filesystem 读
  const read = await Filesystem.readFile({ path: file.uri });
  const text =
    typeof read.data === 'string' ? read.data : await blobToString(read.data as Blob);

  return { name: file.name ?? 'backup.json', text };
}

async function blobToString(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('读取文件失败'));
    r.readAsText(blob, 'utf-8');
  });
}

/** 数据在哪（安卓版的大白话说明） */
export async function androidDataLocation(): Promise<string> {
  return `主数据：本应用私有目录（其他应用读不到，卸载会删除）\n导出的备份：文档/${FOLDER}/`;
}
