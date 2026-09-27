/**
 * 人情账 · 给 exe 补图标与版本信息
 *
 * 为什么需要这一步：
 *   electron-builder 在未配置证书时，仍会下载 winCodeSign 包去改 exe 资源。
 *   那个包里含 macOS 的符号链接，非管理员 Windows 账户解压会失败。
 *   所以我们关掉了 signAndEditExecutable，改由这个脚本用 rcedit 直接补上。
 *
 *   效果与内建流程一致：图标、产品名、版本号、公司名都会写进 exe。
 *
 * 用法：node scripts/patch-exe-icon.mjs [exe路径]
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 找到 rcedit（在 electron-builder 的 winCodeSign 缓存里） */
function findRcedit() {
  const cacheRoot = join(homedir(), 'AppData', 'Local', 'electron-builder', 'Cache');
  if (!existsSync(cacheRoot)) return null;

  // 先找已解压好的
  for (const dir of readdirSync(cacheRoot)) {
    const p = join(cacheRoot, dir, 'rcedit-x64.exe');
    if (existsSync(p)) return p;

    // winCodeSign/<随机名>/rcedit-x64.exe
    const sub = join(cacheRoot, dir);
    if (!existsSync(sub)) continue;
    try {
      for (const inner of readdirSync(sub)) {
        const q = join(sub, inner, 'rcedit-x64.exe');
        if (existsSync(q)) return q;
      }
    } catch {
      /* ignore */
    }
  }

  // 再找 7z 包里的
  for (const dir of readdirSync(cacheRoot)) {
    if (!dir.startsWith('winCodeSign')) continue;
    const sub = join(cacheRoot, dir);
    try {
      for (const inner of readdirSync(sub)) {
        const q = join(sub, inner, 'rcedit-x64.exe');
        if (existsSync(q)) return q;
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/* 目标 exe：命令行指定，或默认免安装目录里的那个 */
const target =
  process.argv[2] || join(ROOT, 'release', 'win-unpacked', 'RenqingLedger.exe');

if (!existsSync(target)) {
  console.error('找不到 exe：' + target);
  console.error('请先跑 pnpm build:win:dir');
  process.exit(1);
}

const rcedit = findRcedit();
if (!rcedit) {
  console.warn('⚠ 找不到 rcedit，跳过图标注入。');
  console.warn('  可以先跑 node scripts/prepare-builder-cache.mjs');
  process.exit(0);
}

const icon = join(ROOT, 'build', 'icon.ico');
if (!existsSync(icon)) {
  console.error('找不到 build/icon.ico，请先跑 pnpm icons');
  process.exit(1);
}

console.log('\n注入 exe 图标与版本信息…\n');
console.log('  exe    : ' + target);
console.log('  icon   : ' + icon);
console.log('  rcedit : ' + rcedit + '\n');

const args = [
  target,
  '--set-icon', icon,
  '--set-version-string', 'ProductName', '人情账',
  '--set-version-string', 'FileDescription', '人情账 · 本地往来礼金账本',
  '--set-version-string', 'CompanyName', pkg.author || 'RenqingLedger',
  '--set-version-string', 'LegalCopyright', 'MIT Licensed',
  '--set-version-string', 'OriginalFilename', 'RenqingLedger.exe',
  '--set-file-version', pkg.version,
  '--set-product-version', pkg.version,
];

/**
 * 跑 rcedit，遇到「文件被占用」时重试。
 *
 * 常见场景：上一次测试启动的 Electron 进程还没退干净，exe 被锁住。
 * 这种情况重试通常就好，不该让整个构建失败。
 */
function tryRcedit(args) {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      execFileSync(rcedit, args, { stdio: 'pipe' });
      return { ok: true, attempt };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const busy = /being used by another process|另一个程序正在使用|拒绝访问|access is denied|EBUSY|EPERM/i.test(
        msg,
      );
      if (busy && attempt < 4) {
        console.log(`  exe 被占用，等 2 秒重试（第 ${attempt} 次）…`);
        /* 同步等待：这个脚本是同步流程，用 Atomics 做阻塞 sleep */
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
        continue;
      }
      return { ok: false, error: msg.split('\n')[0], busy };
    }
  }
  return { ok: false, error: '重试次数用尽' };
}

const r = tryRcedit(args);

if (r.ok) {
  console.log(`✓ 完成${r.attempt > 1 ? `（第 ${r.attempt} 次成功）` : ''}\n`);
} else {
  console.error('✗ 注入失败：' + r.error);
  if (r.busy) {
    console.error('  原因：exe 正在被占用。请先关掉正在运行的「人情账」再重新打包。');
  }
  console.error('  （不影响应用功能，只是 exe 图标会是 Electron 默认的）');
  /*
   * 刻意 exit 0：图标是锦上添花，不该因为它让整个构建失败。
   * 真正的失败（找不到 exe / 找不到 rcedit）在更早的地方已经 exit 1 了。
   */
}

