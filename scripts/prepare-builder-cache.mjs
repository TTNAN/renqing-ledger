/**
 * 人情账 · 本地镜像代理（仅构建期使用）
 *
 * 背景：
 *   electron-builder 的 app-builder.exe 会从 GitHub 直连下载 NSIS 工具链，
 *   国内网络 443 超时（dial tcp ... connectex: A connection attempt failed）。
 *   它不读 ELECTRON_BUILDER_BINARIES_MIRROR（那是 npm 层的变量，Go 二进制不认）。
 *
 * 做法：
 *   起一个本地 HTTP 服务，把 app-builder 要的 URL 路径映射到本地已下载的文件，
 *   然后用 hosts 或代理设置让它走这里。
 *
 *   更简单的办法：直接把已下载的文件按 app-builder 期望的缓存路径放好，
 *   它检测到缓存命中就不会下载。这个脚本负责「放好」这一步。
 *
 * 用法：node scripts/prepare-builder-cache.mjs
 */
import { mkdirSync, existsSync, copyFileSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CACHE = join(homedir(), 'AppData', 'Local', 'electron-builder', 'Cache');
const MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries';

/** 需要预置的工具链：名称 → 版本 */
const PACKAGES = [
  { name: 'nsis', version: '3.0.4.1' },
  { name: 'nsis-resources', version: '3.4.1' },
];

/** 找到 7za（pnpm 的符号链接结构下路径不固定，动态找） */
function find7za() {
  const pnpmDir = join(process.cwd(), 'node_modules', '.pnpm');
  if (!existsSync(pnpmDir)) throw new Error('找不到 node_modules/.pnpm');

  for (const dir of readdirSync(pnpmDir)) {
    if (!dir.startsWith('7zip-bin@')) continue;
    const p = join(pnpmDir, dir, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe');
    if (existsSync(p)) return p;
  }
  throw new Error('找不到 7za.exe');
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { writeFileSync } = await import('node:fs');
  writeFileSync(dest, buf);
  return buf.length;
}

console.log('\n准备 electron-builder 离线缓存…\n');
console.log('  缓存目录: ' + CACHE + '\n');

const sevenZip = find7za();

for (const pkg of PACKAGES) {
  const folderName = `${pkg.name}-${pkg.version}`;
  const archivePath = join(CACHE, `${folderName}.7z`);

  // electron-builder 的目录布局：Cache/<name>/<name>-<version>/
  const targetDir = join(CACHE, pkg.name, folderName);

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    console.log(`  ✓ ${folderName} 已就绪`);
    continue;
  }

  // 下载 7z（如果还没有）
  if (!existsSync(archivePath)) {
    const url = `${MIRROR}/${folderName}/${folderName}.7z`;
    process.stdout.write(`  ↓ ${folderName}.7z … `);
    const size = await download(url, archivePath);
    console.log(`${(size / 1024 / 1024).toFixed(1)} MB`);
  }

  // 解压（-snl 跳过符号链接，非管理员 Windows 账户也能解）
  mkdirSync(targetDir, { recursive: true });
  process.stdout.write(`  ↻ 解压 ${folderName} … `);
  try {
    execFileSync(sevenZip, ['x', '-snl', '-bd', archivePath, `-o${targetDir}`, '-y'], {
      stdio: 'pipe',
    });
    console.log('完成');
  } catch (e) {
    // 7z 遇到符号链接会返回非 0，但文件其实已经解出来了
    const files = readdirSync(targetDir);
    if (files.length > 0) {
      console.log(`完成（跳过 ${files.length} 项符号链接）`);
    } else {
      throw e;
    }
  }
}

/* 校验 */
console.log('\n校验：');
const makensis = join(CACHE, 'nsis', 'nsis-3.0.4.1', 'makensis.exe');
console.log('  makensis.exe  ' + (existsSync(makensis) ? '✓' : '✗'));
const nsisRes = join(CACHE, 'nsis', 'nsis-resources-3.4.1');
console.log('  nsis-resources ' + (existsSync(nsisRes) ? '✓' : '✗'));

if (!existsSync(makensis)) {
  console.error('\n准备失败：makensis.exe 不在预期位置。');
  process.exit(1);
}

console.log('\n完成。现在可以运行 pnpm build:win\n');

/* 清掉可能干扰的临时解压目录 */
for (const dir of readdirSync(CACHE)) {
  if (/^\d+$/.test(dir)) {
    try {
      rmSync(join(CACHE, dir), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
