/**
 * 人情账 · Android 构建脚本
 *
 * 用法：
 *   node scripts/build-android.mjs              # debug + release 都打
 *   node scripts/build-android.mjs --debug      # 只打 debug
 *   node scripts/build-android.mjs --release    # 只打 release
 *
 * 做的事：
 *   1. 构建前端（vite build）
 *   2. cap sync android —— 把前端产物与插件同步进原生工程
 *   3. 把生成的图标/启动画面复制进 res/
 *   4. 调 gradlew assembleDebug / assembleRelease
 *   5. 把 APK 收集到 release-android/ 并改名带版本号
 *
 * 签名从环境变量或 android/keystore.properties 读（见 docs/android-signing.md）。
 * 两者都没有时，release 会产出未签名 APK 并给出明确提示。
 */
import { execSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ANDROID = join(ROOT, 'android');
const OUT = join(ROOT, 'release-android');

const args = process.argv.slice(2);
const onlyDebug = args.includes('--debug');
const onlyRelease = args.includes('--release');
const buildDebug = onlyDebug || (!onlyDebug && !onlyRelease);
const buildRelease = onlyRelease || (!onlyDebug && !onlyRelease);

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/* ---------------------------------------------------------------- 工具 */

/**
 * 跑一条命令。
 *
 * Windows 上 gradlew.bat 必须经 shell 调用，而 execFileSync + shell:true
 * 会把参数重新拼接，`--no-daemon` 这类以 `-` 开头的参数容易被 cmd 吞掉，
 * 表现为 Gradle「startup failed: 1 error」这种莫名其妙的错。
 * 所以这里显式拼命令串再交给 execSync，行为可预期。
 */
function run(cmd, cmdArgs, opts = {}) {
  const line = [cmd, ...cmdArgs].join(' ');
  console.log(`\n> ${line}\n`);
  execSync(line, {
    stdio: 'inherit',
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
    shell: true,
  });
}

function step(n, total, text) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${n}/${total}  ${text}`);
  console.log('='.repeat(60));
}

const TOTAL = 6;

/* ---------------------------------------------------------------- 环境 */

step(1, TOTAL, '检查 Android 环境');

/** 找 JDK：优先环境变量，其次项目里可能存在的工具链 */
function findJavaHome() {
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', 'java.exe'))) {
    return process.env.JAVA_HOME;
  }
  // 之前为其他项目下载过的工具链
  const candidates = [
    'E:\\renqingzhang\\tools\\jdkraw',
    join(process.env.LOCALAPPDATA || '', 'Programs', 'Eclipse Adoptium'),
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
  ];
  for (const base of candidates) {
    if (!existsSync(base)) continue;
    // 目录下可能还有一层版本目录
    for (const entry of readdirSync(base)) {
      const p = join(base, entry);
      if (existsSync(join(p, 'bin', 'java.exe'))) return p;
      if (existsSync(join(base, 'bin', 'java.exe'))) return base;
    }
  }
  return null;
}

const javaHome = findJavaHome();
if (!javaHome) {
  console.error(`
找不到 JDK，无法构建 Android 包。

  需要 JDK 17 或更高版本。三选一：

  1. 装 Temurin（推荐，免费）
     https://adoptium.net/temurin/releases/?version=17
     装完把 JAVA_HOME 指向安装目录

  2. 用 winget
     winget install EclipseAdoptium.Temurin.17.JDK

  3. 已有 JDK，只是没告诉本脚本
     设置环境变量 JAVA_HOME，例如：
       setx JAVA_HOME "C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.13.11-hotspot"

  设好后重新打开终端，再跑 pnpm build:android。

  （只想要 Windows 包和单文件版的话，可以跳过 Android：
      pnpm build:all --skip-android）
`);
  process.exit(1);
}
console.log('  JDK: ' + javaHome);

/** 找 Android SDK */
function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    'E:\\renqingzhang\\tools\\sdk',
    join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
  ].filter(Boolean);

  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

const androidSdk = findAndroidSdk();
if (androidSdk) {
  console.log('  Android SDK: ' + androidSdk);
} else {
  console.log('  Android SDK: 未找到，交给 Gradle 自行解析（需要 android/local.properties）');
}

/* 写 local.properties（Gradle 靠它找 SDK） */
if (androidSdk) {
  const localProps = join(ANDROID, 'local.properties');
  const sdkDir = androidSdk.replace(/\\/g, '\\\\');
  const content = `# 本机 Android SDK 位置（由 scripts/build-android.mjs 生成，不入库）\nsdk.dir=${sdkDir}\n`;
  const { writeFileSync } = await import('node:fs');
  writeFileSync(localProps, content, 'utf8');
  console.log('  已写入 android/local.properties');
}

/* ---------------------------------------------------------------- 前端 */

step(2, TOTAL, '构建前端');
run('node', [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build']);

/* ---------------------------------------------------------------- 图标 */

step(3, TOTAL, '生成并复制图标与启动画面');

/*
 * 先重新生成一遍图标，再复制进原生工程。
 *
 * 为什么必须在这里生成，而不是只复制：
 *   android-res/ 是「上次生成的结果」。如果素材更新了却忘了重跑图标脚本，
 *   这里会把旧图标复制进去，打出来的 APK 就带着过期图标 —— 而且看不出来。
 *   所以构建时主动生成一次，保证 APK 里的图标一定对应当前素材。
 */
const hasOfficialIcons = existsSync(join(ROOT, 'assets', 'icons', 'source'));

if (hasOfficialIcons) {
  try {
    run('node', [join(ROOT, 'scripts', 'make-icons-from-source.mjs')], {
      env: { ...process.env, JAVA_HOME: javaHome },
    });
  } catch {
    console.warn('  ⚠ 图标生成失败，将使用 android-res/ 里已有的文件');
  }
} else {
  console.warn('  ⚠ 没找到 assets/icons/source/，跳过生成，直接用 android-res/ 里已有的');
}

const iconSrc = join(ROOT, 'android-res');
const resDst = join(ANDROID, 'app', 'src', 'main', 'res');

if (existsSync(iconSrc)) {
  let copied = 0;
  const walk = (dir, rel = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const src = join(dir, entry.name);
      const relPath = rel ? join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        walk(src, relPath);
      } else {
        const dst = join(resDst, relPath);
        mkdirSync(join(dst, '..'), { recursive: true });
        copyFileSync(src, dst);
        copied += 1;
      }
    }
  };
  walk(iconSrc);
  console.log(`  已复制 ${copied} 个图标/启动图到 android/app/src/main/res/`);
} else {
  console.error('  没有 android-res/，图标无法生成。请先跑 pnpm icons');
  process.exit(1);
}

/* ---------------------------------------------------------------- 同步 */

step(4, TOTAL, '同步 Capacitor（前端产物 + 原生插件）');

const capCli = join(ROOT, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
run('node', [capCli, 'sync', 'android'], {
  env: { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: androidSdk || '' },
});

/**
 * 校验同步结果：Android 工程里的前端产物必须与 dist 一致。
 *
 * 为什么要查这个：
 *   Gradle 的增量构建只看它的输入文件。cap sync 拷进去的新 JS 文件名带内容哈希
 *   （index-<hash>.js），文件名变了 Gradle 通常会重打；
 *   但如果它判断「没变化」就会复用旧 APK，产物时间戳不变，
 *   让人误以为构建没跑。这里主动比对，不一致就强制 clean。
 */
function verifySync() {
  const distAssets = join(ROOT, 'dist', 'assets');
  const androidAssets = join(ANDROID, 'app', 'src', 'main', 'assets', 'public', 'assets');

  if (!existsSync(distAssets) || !existsSync(androidAssets)) return { ok: false, why: '目录不存在' };

  const distJs = readdirSync(distAssets).filter((f) => f.endsWith('.js')).sort();
  const androidJs = readdirSync(androidAssets).filter((f) => f.endsWith('.js')).sort();

  const missing = distJs.filter((f) => !androidJs.includes(f));
  if (missing.length > 0) {
    return { ok: false, why: `Android 工程缺少 ${missing.length} 个文件：${missing.slice(0, 3).join(', ')}` };
  }
  return { ok: true, count: distJs.length };
}

const syncCheck = verifySync();
let needClean = false;

if (syncCheck.ok) {
  console.log(`  ✓ 前端产物已同步（${syncCheck.count} 个 JS 文件一致）`);
} else {
  console.warn(`  ⚠ 同步校验异常：${syncCheck.why}`);
  console.warn('    将强制 clean 后重新构建');
  needClean = true;
}

/* ---------------------------------------------------------------- 构建 */

step(5, TOTAL, 'Gradle 构建 APK');

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const gradleEnv = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidSdk || process.env.ANDROID_HOME || '',
};

mkdirSync(OUT, { recursive: true });

const built = [];

/* 同步校验没过就先 clean，避免 Gradle 复用旧 APK */
if (needClean) {
  console.log('\n--- 强制 clean ---');
  run(gradlew, ['clean', '--no-daemon'], { cwd: ANDROID, env: gradleEnv });
}

if (buildDebug) {
  console.log('\n--- Debug APK ---');
  run(gradlew, ['assembleDebug', '--no-daemon'], { cwd: ANDROID, env: gradleEnv });

  const src = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (existsSync(src)) {
    const dst = join(OUT, `人情账-${pkg.version}-debug.apk`);
    copyFileSync(src, dst);
    built.push({ name: `人情账-${pkg.version}-debug.apk`, path: dst, size: statSync(dst).size });
  } else {
    console.error('  没找到 debug APK');
  }
}

if (buildRelease) {
  console.log('\n--- Release APK ---');
  run(gradlew, ['assembleRelease', '--no-daemon'], { cwd: ANDROID, env: gradleEnv });

  const dir = join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release');
  if (existsSync(dir)) {
    // 已签名的是 app-release.apk，未签名的是 app-release-unsigned.apk
    const signed = join(dir, 'app-release.apk');
    const unsigned = join(dir, 'app-release-unsigned.apk');

    if (existsSync(signed)) {
      const dst = join(OUT, `人情账-${pkg.version}-release.apk`);
      copyFileSync(signed, dst);
      built.push({
        name: `人情账-${pkg.version}-release.apk`,
        path: dst,
        size: statSync(dst).size,
        signed: true,
      });
    } else if (existsSync(unsigned)) {
      const dst = join(OUT, `人情账-${pkg.version}-release-unsigned.apk`);
      copyFileSync(unsigned, dst);
      built.push({
        name: `人情账-${pkg.version}-release-unsigned.apk`,
        path: dst,
        size: statSync(dst).size,
        signed: false,
      });
    }
  } else {
    console.error('  没找到 release APK 输出目录');
  }
}

/* ---------------------------------------------------------------- 汇总 */

step(6, TOTAL, '构建结果');

/**
 * 最终校验：APK 里打包的前端资源，必须与 dist 里的一致。
 *
 * 这是最后一道防线。Gradle 的增量构建可能复用旧 APK（时间戳不变），
 * 光看文件时间会误判。这里直接读 APK 里的 JS，比对 dist 的文件名。
 * 不一致就报错，而不是默默产出一个旧代码的包。
 */
function verifyApkAssets(apkPath) {
  try {
    /* 用 unzip 列出 APK 内容（Windows 10+ 自带 tar 支持 zip） */
    const listing = execSync(`tar -tf "${apkPath}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 16 * 1024 * 1024,
    });
    const inApk = listing
      .split('\n')
      .filter((l) => /assets\/public\/assets\/index-.*\.js$/.test(l.trim()))
      .map((l) => l.trim().split('/').pop());

    const distAssets = join(ROOT, 'dist', 'assets');
    const distMain = readdirSync(distAssets)
      .filter((f) => /^index-.*\.js$/.test(f))
      .sort();

    const missing = distMain.filter((f) => !inApk.includes(f));
    return { ok: missing.length === 0, inApk, distMain, missing };
  } catch (e) {
    return { ok: null, error: e instanceof Error ? e.message.split('\n')[0] : String(e) };
  }
}

let assetCheckFailed = false;
for (const b of built) {
  const v = verifyApkAssets(b.path);
  if (v.ok === true) {
    console.log(`  ✓ ${b.name}：前端资源与 dist 一致`);
  } else if (v.ok === false) {
    assetCheckFailed = true;
    console.error(`  ✗ ${b.name}：打包的是旧代码！`);
    console.error(`      APK 内: ${v.inApk.join(', ') || '(无)'}`);
    console.error(`      dist  : ${v.distMain.join(', ') || '(无)'}`);
  } else {
    console.log(`  · ${b.name}：资源校验跳过（${v.error}）`);
  }
}

if (assetCheckFailed) {
  console.error('\n构建产物的前端资源是旧的，不要分发。');
  console.error('请跑：cd android && gradlew clean，然后重新 pnpm build:android\n');
  process.exit(1);
}

if (built.length === 0) {
  console.error('没有产出任何 APK。');
  process.exit(1);
}

for (const b of built) {
  const mb = (b.size / 1024 / 1024).toFixed(1);
  const signNote = b.signed === undefined ? '' : b.signed ? '  [已签名]' : '  [未签名]';
  console.log(`  ${b.name}  (${mb} MB)${signNote}`);
}

console.log('\n输出目录：release-android/\n');

if (built.some((b) => b.signed === false)) {
  console.log('提示：release 包未签名，无法直接安装。');
  console.log('  请按 docs/android-signing.md 生成 keystore 并设置环境变量后重打。\n');
}

/* 顺手校验签名（如果有 apksigner） */
const apksignerCandidates = [];
if (androidSdk) {
  const bt = join(androidSdk, 'build-tools');
  if (existsSync(bt)) {
    for (const v of readdirSync(bt)) {
      const p = join(bt, v, 'apksigner.bat');
      if (existsSync(p)) apksignerCandidates.push(p);
    }
  }
}

if (apksignerCandidates.length > 0 && built.some((b) => b.signed)) {
  const signer = apksignerCandidates[apksignerCandidates.length - 1];
  const target = built.find((b) => b.signed);
  console.log('签名校验：');

  // apksigner.bat 经 shell 传递中文路径会失败，先复制成 ASCII 名再校验
  const asciiCopy = join(OUT, '__verify.apk');
  try {
    copyFileSync(target.path, asciiCopy);
    const javaHome = findJavaHome();
    const out = execSync(`"${signer}" verify --print-certs "${asciiCopy}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, JAVA_HOME: javaHome || '' },
    });
    for (const line of out.split('\n')) {
      const t = line.trim();
      if (t && /Verified using|Signer #1 certificate DN/.test(t)) {
        console.log('  ' + t);
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : '';
    console.log('  （校验跳过：' + msg.slice(0, 80) + '）');
  } finally {
    rmSync(asciiCopy, { force: true });
  }
  console.log('');
}

/* 清理未签名的中间产物，避免混淆 */
try {
  const unsignedDst = join(OUT, `人情账-${pkg.version}-release-unsigned.apk`);
  if (existsSync(unsignedDst) && built.some((b) => b.signed)) {
    rmSync(unsignedDst, { force: true });
  }
} catch {
  /* ignore */
}
