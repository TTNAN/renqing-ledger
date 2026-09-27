/**
 * 人情账 · 一键构建全部发行版
 *
 *   pnpm build:all
 *
 * 为什么需要这个脚本：
 *   之前改完代码只重新打了 exe 和 APK，忘了 `人情账.html`，
 *   结果单文件版停留在旧代码上 —— 修好的 bug 在那边依然存在。
 *   三种形态（浏览器单文件 / Windows / Android）是同一套前端的三份产物，
 *   改了源码就必须三份一起重打，靠人记是会漏的。
 *
 * 产出：
 *   release-android/人情账-<版本>-{debug,release}.apk
 *   release/RenqingLedger-Setup-<版本>.exe
 *   人情账.html
 *   dist/                         （浏览器版）
 *
 * 可选参数：
 *   --skip-win       跳过 Windows 打包（没装 Electron 工具链时）
 *   --skip-android   跳过 Android 打包（没装 JDK/SDK 时）
 */
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const skipWin = args.includes('--skip-win');
const skipAndroid = args.includes('--skip-android');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

/** 跑一条命令，失败就抛 */
function run(label, cmd, opts = {}) {
  console.log(`\n${'─'.repeat(66)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(66));
  execSync(cmd, {
    stdio: 'inherit',
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
    shell: true,
  });
}

/**
 * 找到真正的 node 可执行文件。
 *
 * 为什么不能直接用 process.execPath：
 *   在 DSH / Electron 这类宿主里经 pnpm 运行脚本时，
 *   process.execPath 指向的是**宿主自己的 exe**（例如 "DSH Desktop.exe"），
 *   而不是 node。拿它去 spawn 一个 .js 会变成「用宿主的 exe 执行脚本」，
 *   宿主不认识那些参数，于是打印自己的帮助并退出 1 ——
 *   报错信息里会诡异地出现宿主程序名。
 *
 * 所以这里按顺序找一个可信的 node：
 *   1. npm_node_execpath（npm/pnpm 会设置，指向真正的 node）
 *   2. NODE_BINARY / NODE_EXE 环境变量
 *   3. process.execPath（前提是它看起来像 node）
 *   4. PATH 里的 node
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

  /* execPath 只在它确实叫 node 时才可信 */
  if (/node(\.exe)?$/i.test(process.execPath)) return process.execPath;

  /* 从 PATH 里找 */
  const pathDirs = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  for (const dir of pathDirs) {
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
 * 三个坑，逐个绕开：
 *
 *  1. `pnpm exec electron-builder --win ...` 参数会被吞，
 *     electron-builder 收到空参数就打印帮助并 **exit 0**（看起来像成功）。
 *  2. 用 execSync(字符串, { shell: true }) 时参数要过 cmd 重新解析，同样会被吞。
 *  3. 用 spawnSync(process.execPath, ...) 在 DSH/Electron 宿主里会拿到宿主的 exe，
 *     变成「宿主程序执行 cli.js」，报错信息里会出现宿主程序名。
 *
 * 所以：显式找到真正的 node + spawnSync 传参数数组，不经 shell。
 */
function runElectronBuilder(extraArgs, env = {}) {
  if (!NODE_BIN) {
    throw new Error('找不到 node 可执行文件，无法调用 electron-builder');
  }

  const cli = join(ROOT, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js');

  console.log(`\n${'─'.repeat(66)}`);
  console.log(`  electron-builder ${extraArgs.join(' ')}`);
  console.log(`  （node: ${NODE_BIN}）`);
  console.log('─'.repeat(66));

  const r = spawnSync(NODE_BIN, [cli, ...extraArgs], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  const out = (r.stdout || '') + (r.stderr || '');
  process.stdout.write(out);

  if (r.status !== 0) {
    throw new Error(`electron-builder 退出码 ${r.status}`);
  }

  /*
   * 打印了帮助 = 参数没送到，这是失败而不是成功。
   * 只在确实出现 Commands: 段落时判定 —— 不要拿 Building: 当判据，
   * 那个词在正常日志里也可能出现。
   */
  if (/^\s*Commands:/m.test(out)) {
    throw new Error('electron-builder 打印了帮助文本，说明参数没送达');
  }
}

/** 跑一条命令，失败只警告不中断。cmd 可以是字符串，也可以是函数。 */
function tryRun(label, cmd, opts = {}) {
  try {
    if (typeof cmd === 'function') {
      console.log(`\n${'─'.repeat(66)}`);
      console.log(`  ${label}`);
      console.log('─'.repeat(66));
      cmd();
    } else {
      run(label, cmd, opts);
    }
    return true;
  } catch (e) {
    console.warn(`\n  ⚠ ${label} 失败：${e instanceof Error ? e.message : e}`);
    console.warn('     （跳过，不影响其他产物）\n');
    return false;
  }
}

const built = [];
const skipped = [];

console.log(`\n人情账 ${VERSION} · 构建全部发行版\n`);
console.log('  会产出三份产物：单文件 HTML / Windows 安装包 / Android APK');
console.log('  （用 --skip-win 或 --skip-android 可跳过对应平台）');

/* ---------------------------------------------------------------- 0. 图标 */

/*
 * 图标必须最先生成 —— favicon 得在 vite build 之前放进 public/，
 * 否则不会被打进 dist/ 和单文件版。
 *
 * 素材优先，占位兜底。
 * 这里踩过坑：之前硬编码调的是占位图标脚本，
 * 结果把正式素材生成的好图标覆盖掉了 —— exe 里嵌的还是占位图。
 * 所以顺序必须是「正式素材优先」。
 */
const hasOfficialIcons = existsSync(join(ROOT, 'assets', 'icons', 'source'));

if (hasOfficialIcons) {
  tryRun('0/6  生成各平台图标', 'node scripts/make-icons-from-source.mjs');
  tryRun('     生成 favicon', 'node scripts/make-favicon.mjs');
} else {
  console.warn('\n  ⚠ 没找到 assets/icons/source/，改用占位图标');
  console.warn('    （正式素材应放在该目录，见 README 的「图标」一节）\n');
  tryRun('0/6  生成图标（占位）', 'node scripts/make-icons.mjs');
}

/* ---------------------------------------------------------------- 1. 类型与测试 */

run('1/6  类型检查与单元测试', 'pnpm exec tsc --noEmit && pnpm exec vitest run');

/* ---------------------------------------------------------------- 2. 前端 */

run('2/6  构建前端（dist/）', 'node node_modules/vite/bin/vite.js build');

/* ---------------------------------------------------------------- 3. 单文件 HTML */

run('3/6  构建单文件 HTML', 'node scripts/build-single.mjs');

const singlePath = join(ROOT, '人情账.html');
if (existsSync(singlePath)) {
  built.push({
    name: '人情账.html',
    size: statSync(singlePath).size,
    note: '双击即用',
  });
}

/* ---------------------------------------------------------------- 5. Windows */

if (skipWin) {
  skipped.push('Windows（--skip-win）');
} else {
  /* Electron 工具链在不在 */
  const electronDir = join(ROOT, 'node_modules', '.pnpm');
  let hasElectron = false;
  if (existsSync(electronDir)) {
    hasElectron = readdirSync(electronDir).some((d) => d.startsWith('electron@'));
  }

  if (!hasElectron) {
    console.warn('\n  ⚠ 没装 Electron，跳过 Windows 打包（pnpm install 后再试）');
    skipped.push('Windows（缺 Electron）');
  } else {
    const env = { ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/' };

    const dirOk = tryRun(
      '5/6  Windows：打包免安装目录',
      () => runElectronBuilder(['--win', '--x64', '--dir'], env),
    );

    if (dirOk) {
      tryRun('     注入 exe 图标与版本信息', 'node scripts/patch-exe-icon.mjs');

      const nsisOk = tryRun(
        '     Windows：生成 NSIS 安装包',
        () => runElectronBuilder(['--win', '--x64'], env),
      );

      if (!nsisOk) {
        console.warn('     （NSIS 失败通常是工具链没下全，先跑 pnpm prepare:builder）');
      }
    }

    const setup = join(ROOT, 'release', `RenqingLedger-Setup-${VERSION}.exe`);
    if (existsSync(setup)) {
      const size = statSync(setup).size;
      /*
       * 关键：光看文件存在不够。
       * NSIS 失败时仍会留下一个残次品（几百 KB），
       * 那是空壳安装包，装出来是坏的。
       * 正常安装包内嵌整个 Electron 运行时，至少几十 MB。
       */
      const MIN_INSTALLER = 30 * 1024 * 1024;
      if (size < MIN_INSTALLER) {
        console.error(
          `\n  ✗ Windows 安装包只有 ${(size / 1024).toFixed(0)} KB，明显不完整（应 > 30 MB）`,
        );
        console.error('    多半是 NSIS 工具链缺失。先跑：pnpm prepare:builder');
        console.error('    然后重新 pnpm build:all\n');
        rmSync(setup, { force: true }); // 删掉残次品，避免误发
        skipped.push('Windows 安装包（不完整，已删除）');
      } else {
        built.push({
          name: `RenqingLedger-Setup-${VERSION}.exe`,
          size,
          note: 'Windows 安装包',
        });
      }
    } else {
      skipped.push('Windows 安装包');
    }
  }
}

/* ---------------------------------------------------------------- 6. Android */

if (skipAndroid) {
  skipped.push('Android（--skip-android）');
} else {
  const androidDir = join(ROOT, 'android');
  if (!existsSync(androidDir)) {
    console.warn('\n  ⚠ 没有 android/ 工程，跳过（先跑 pnpm exec cap add android）');
    skipped.push('Android（无工程）');
  } else {
    /* 找 JDK：环境变量优先，其次本机曾为其他项目准备的工具链 */
    const JAVA_CANDIDATES = [
      'E:\\renqingzhang\\tools\\jdkraw',
      'C:\\Program Files\\Eclipse Adoptium',
      'C:\\Program Files\\Java',
    ];

    function findJavaHome() {
      if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java.exe'))) {
        return process.env.JAVA_HOME;
      }
      for (const base of JAVA_CANDIDATES) {
        if (!existsSync(base)) continue;
        if (existsSync(join(base, 'bin', 'java.exe'))) return base;
        for (const d of readdirSync(base)) {
          const p = join(base, d);
          if (existsSync(join(p, 'bin', 'java.exe'))) return p;
        }
      }
      return null;
    }

    const javaHome = findJavaHome();

    const ok = tryRun('6/6  Android：构建 debug + release APK', 'node scripts/build-android.mjs', {
      env: javaHome ? { JAVA_HOME: javaHome } : {},
    });

    if (ok) {
      for (const variant of ['debug', 'release']) {
        const p = join(ROOT, 'release-android', `人情账-${VERSION}-${variant}.apk`);
        if (!existsSync(p)) continue;

        const size = statSync(p).size;
        /* APK 至少 1 MB；更小说明打包不完整 */
        if (size < 1 * 1024 * 1024) {
          console.error(`\n  ✗ ${variant} APK 只有 ${(size / 1024).toFixed(0)} KB，不完整，已删除`);
          rmSync(p, { force: true });
          continue;
        }

        built.push({
          name: `人情账-${VERSION}-${variant}.apk`,
          size,
          note: variant === 'release' ? 'Android 签名包' : 'Android 调试包',
        });
      }
    } else {
      skipped.push('Android APK');
    }
  }
}

/* ---------------------------------------------------------------- 汇总 */

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB';
const kb = (n) => Math.round(n / 1024) + ' KB';

console.log(`\n${'═'.repeat(66)}`);
console.log(`  构建完成 · 人情账 ${VERSION}`);
console.log('═'.repeat(66) + '\n');

for (const b of built) {
  const size = b.size > 1024 * 1024 ? mb(b.size) : kb(b.size);
  console.log(`  ✅ ${b.name.padEnd(38)} ${size.padStart(9)}   ${b.note}`);
}

if (skipped.length) {
  console.log('');
  for (const s of skipped) console.log(`  ⏭  ${s}`);
}

console.log('');

/* 只列出 package.json 里真实存在的验证命令 —— 硬编码会指向被删掉的脚本 */
const verifyCmds = Object.keys(pkg.scripts || {}).filter((k) => k.startsWith('verify'));
if (verifyCmds.length > 0) {
  console.log('  验证（可选，但建议每次发版前跑一遍）：');
  for (const c of verifyCmds) {
    console.log(`    pnpm ${c.padEnd(20)} ${pkg.scripts[c]}`);
  }
  console.log('');
}

if (built.length === 0) {
  console.error('  没有产出任何东西，请检查上面的错误。\n');
  process.exit(1);
}

/* 三份产物齐全才算完整成功 */
const hasSingle = built.some((b) => b.name.endsWith('.html'));
const hasWin = built.some((b) => b.name.endsWith('.exe'));
const hasApk = built.some((b) => b.name.endsWith('.apk'));

if (!hasSingle) {
  console.error('  ⚠ 缺单文件 HTML —— 这是最容易被漏掉的那份产物。\n');
  process.exit(1);
}

if (!hasWin || !hasApk) {
  console.log('  提示：本次未产出全部三种形态（见上面的 ⏭ 行）。');
  console.log('        如果只是临时跳过，可以忽略；发版请确保三份齐全。\n');
}
