/**
 * 人情账 · Windows 打包
 *
 *   pnpm build:win          产出 NSIS 安装包
 *   pnpm build:win:dir      只出免安装目录（调试用）
 *
 * 为什么不用 electron-builder 的 pnpm script 直调：
 *   pnpm exec electron-builder 的参数解析在某些版本下会把
 *   cli.js 路径当成未知参数（Unknown argument），必须直接 node 调 cli.js。
 *
 * 另外这里把「补图标」也串进来了：
 *   未配置代码签名证书时，electron-builder 会跳过 exe 资源编辑
 *   （它依赖的 winCodeSign 包含 macOS 符号链接，非管理员账户解压会失败），
 *   所以图标与版本信息要在打包后用 rcedit 补上。
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dirOnly = process.argv.includes('--dir');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function run(label, cmd, env = {}) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
  execSync(cmd, {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...process.env, ...env },
    shell: true,
  });
}

function tryRun(label, cmd, env = {}) {
  try {
    run(label, cmd, env);
    return true;
  } catch {
    console.warn(`\n  ⚠ ${label} 失败\n`);
    return false;
  }
}

/**
 * 找真正的 node。
 *
 * 在 DSH / Electron 宿主里经 pnpm 运行时，process.execPath 指向宿主自己的 exe
 * （例如 "DSH Desktop.exe"），拿它 spawn .js 会变成「宿主执行脚本」，
 * 报错里会出现宿主程序名。所以要显式找一个可信的 node。
 */
function findNodeBinary() {
  const candidates = [
    process.env.npm_node_execpath,
    process.env.NODE_BINARY,
    process.env.NODE_EXE,
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c) && /node(\.exe)?$/i.test(c)) return c;
  }
  if (/node(\.exe)?$/i.test(process.execPath)) return process.execPath;
  for (const dir of (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue;
    const p = join(dir, process.platform === 'win32' ? 'node.exe' : 'node');
    if (existsSync(p)) return p;
  }
  return null;
}

const NODE_BIN = findNodeBinary();

/**
 * 调 electron-builder。
 *
 * 必须：真正的 node + spawnSync 参数数组，不经 shell。
 * 详见 build-release.mjs 里同一函数的注释（三个坑）。
 */
function runElectronBuilder(extraArgs, env = {}) {
  if (!NODE_BIN) throw new Error('找不到 node 可执行文件');

  const cli = join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  electron-builder ${extraArgs.join(' ')}`);
  console.log('─'.repeat(60));

  const r = spawnSync(NODE_BIN, [cli, ...extraArgs], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);

  if (r.status !== 0) throw new Error(`electron-builder 退出码 ${r.status}`);
  if (/^\s*Commands:/m.test(out)) {
    throw new Error('electron-builder 打印了帮助文本，说明参数没送达');
  }
}

/* 检查 Electron 是否装了 */
const pnpmDir = join(ROOT, 'node_modules', '.pnpm');
const hasElectron =
  existsSync(pnpmDir) && readdirSync(pnpmDir).some((d) => d.startsWith('electron@'));

if (!hasElectron) {
  console.error('\n没装 Electron。先跑 pnpm install。\n');
  process.exit(1);
}

const MIRROR = { ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/' };

console.log(`\n人情账 ${pkg.version} · Windows 打包\n`);

/* 1. 前端 */
run('1/4  构建前端', 'node node_modules/vite/bin/vite.js build');

/* 2. 图标 —— 正式素材优先，占位兜底 */
if (existsSync(join(ROOT, 'assets', 'icons', 'source'))) {
  tryRun('2/4  生成图标（正式素材）', 'node scripts/make-icons-from-source.mjs');
} else {
  console.warn('\n  ⚠ 没找到 assets/icons/source/，改用占位图标\n');
  tryRun('2/4  生成图标（占位）', 'node scripts/make-icons.mjs');
}

/* 3. 打包 */
const target = dirOnly ? ['--win', '--x64', '--dir'] : ['--win', '--x64'];
let packed = true;
try {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(dirOnly ? '3/4  打包免安装目录' : '3/4  生成 NSIS 安装包');
  console.log('─'.repeat(60));
  runElectronBuilder(target, MIRROR);
} catch (e) {
  packed = false;
  console.warn(`\n  ⚠ 打包失败：${e instanceof Error ? e.message : e}\n`);
}

if (!packed) {
  console.error('打包失败。如果是 NSIS 工具链下载问题，先跑：');
  console.error('  pnpm prepare:builder\n');
  process.exit(1);
}

/* 4. 补图标 */
tryRun('4/4  注入 exe 图标与版本信息', 'node scripts/patch-exe-icon.mjs');

/* 汇总 */
console.log(`\n${'═'.repeat(60)}`);
console.log('  完成');
console.log('═'.repeat(60) + '\n');

const exeDir = join(ROOT, 'release', 'win-unpacked', 'RenqingLedger.exe');
if (existsSync(exeDir)) {
  const i = statSync(exeDir);
  console.log(`  ✅ release/win-unpacked/RenqingLedger.exe   ${(i.size / 1024 / 1024).toFixed(1)} MB`);
}

if (!dirOnly) {
  const setup = join(ROOT, 'release', `RenqingLedger-Setup-${pkg.version}.exe`);
  if (existsSync(setup)) {
    const i = statSync(setup);
    console.log(`  ✅ release/RenqingLedger-Setup-${pkg.version}.exe   ${(i.size / 1024 / 1024).toFixed(1)} MB`);
    console.log('\n  这个安装包未签名，首次运行会被 SmartScreen 拦。');
    console.log('  点「更多信息」→「仍要运行」即可。');
  } else {
    console.log('  ⚠ 没找到 NSIS 安装包，检查上面的输出');
  }
}

console.log('');
console.log('  别忘了：改了代码要三份产物一起重打 —— pnpm build:all');
console.log('');
