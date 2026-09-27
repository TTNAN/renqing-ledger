/**
 * 为 README 生成手机端截图
 *
 *   node scripts/make-android-screenshot.mjs
 *
 * 难点：Capacitor 会探测真实运行环境，在浏览器里注入 window.Capacitor
 * 是无法让 platform() 判定成 android 的（实测会被 SDK 覆盖）。
 *
 * 解法：临时把 platform 判定改成「永远返回 android」，
 * 构建一份**仅供截图**的产物，拍完后立即恢复源码。
 * 这样截到的就是手机端真实的界面（无顶栏、手机文案、四项底部导航）。
 */
import { spawn } from 'node:child_process';
import {
  rmSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EDGE =
  process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9590;
const PROFILE = ROOT + '.androidscreen-profile';
const OUTDIR = join(ROOT, '.android-shots');
const PLATFORM = join(ROOT, 'src', 'platform', 'index.ts');
const PLATFORM_BAK = PLATFORM + '.shotbak';

rmSync(PROFILE, { recursive: true, force: true });
rmSync(OUTDIR, { recursive: true, force: true });
mkdirSync(OUTDIR, { recursive: true });

if (!existsSync(EDGE)) {
  console.error('找不到 Edge');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------------------------------------------------------- 打补丁 */

const original = readFileSync(PLATFORM, 'utf8');
copyFileSync(PLATFORM, PLATFORM_BAK);

/*
 * 把 platform() 的返回值硬改成 'android'。
 * 只动这一处判定，其余逻辑（含各处的 isAndroid() 分支）全部照常走。
 */
const patched = original.replace(
  /let cached: PlatformKind \| null = null;\n\nexport function platform\(\): PlatformKind \{[\s\S]*?\n\}/,
  `let cached: PlatformKind | null = null;

export function platform(): PlatformKind {
  /* 截图用：强制按安卓渲染。脚本结束会恢复源码。 */
  return 'android';
}`,
);

if (patched === original) {
  console.error('★ 没能改到 platform()，正则可能失效了');
  process.exit(1);
}

writeFileSync(PLATFORM, patched, 'utf8');
console.log('\n===== 生成手机端截图 =====\n');
console.log('  已临时强制 platform() = android');

/* ---------------------------------------------------------------- 构建 */

let edge;
try {
  const out = await build({
    logLevel: 'silent',
    build: { outDir: '.android-shots/dist' },
  });
  console.log('  已构建截图专用产物');

  /* 用 vite preview 起个静态服务 */
  const { preview } = await import('vite');
  const server = await preview({
    logLevel: 'silent',
    preview: { port: 5280, strictPort: true },
    build: { outDir: '.android-shots/dist' },
  });
  const base = `http://127.0.0.1:5280/`;
  console.log(`  服务已起: ${base}`);

  edge = spawn(
    EDGE,
    [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`, '--user-data-dir=' + PROFILE, 'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  /* 等 DevTools */
  let target = null;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch { /* wait */ }
    await sleep(250);
  }
  if (!target) throw new Error('DevTools 未就绪');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WS 失败')), { once: true });
  });

  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const i = ++id;
      pending.set(i, { resolve: res, reject: rej });
      ws.send(JSON.stringify({ id: i, method, params }));
      setTimeout(() => {
        if (pending.has(i)) { pending.delete(i); rej(new Error('timeout' + method)); }
      }, 90000);
    });
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result?.value;
  };

  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });

  await send('Page.navigate', { url: base });
  await sleep(2800);

  /* 载入示例数据，让界面有内容 */
  const seeded = await ev(`
    (async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const q = (s) => document.querySelector(s);
      const qa = (s) => Array.from(document.querySelectorAll(s));
      const byText = (s, t) => qa(s).find(e => (e.textContent || '').includes(t));
      const click = (el) => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        el.click();
      };
      for (let i = 0; i < 100; i++) {
        if (q('.app') && !q('.loading')) break;
        await sleep(150);
      }
      const seed = byText('button', '载入示例账本');
      if (seed) { click(seed); await sleep(2000); }
      return {
        hasTopbar: !!q('.topbar'),
        navItems: qa('.mobile-nav-item').length,
        navLabels: qa('.mobile-nav-item').map(e => e.textContent.trim()),
      };
    })()
  `);

  console.log(`  顶栏存在: ${seeded.hasTopbar ? '★ 意外（手机不该有）' : '✓ 无（符合预期）'}`);
  console.log(`  底部导航: ${seeded.navLabels.join(' / ')}`);

  /* 逐页截图 */
  const shots = [
    ['android-home.png', '#/', 1600],
    ['android-add.png', '#/add', 1600],
    ['android-suggest.png', '#/suggest', 1600],
    ['android-settings.png', '#/settings', 1600],
  ];

  for (const [file, hash, wait] of shots) {
    await ev(`location.hash = ${JSON.stringify(hash)}; true`);
    await sleep(wait);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUTDIR, file), Buffer.from(shot.data, 'base64'));
    console.log(`  ✓ ${file}`);
  }

  server.httpServer.close();
  console.log(`\n  截图目录: .android-shots\n`);
} catch (err) {
  console.error('❌ ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 2;
} finally {
  /* 无论如何都要恢复源码 —— 绝不能把补丁留在仓库里 */
  copyFileSync(PLATFORM_BAK, PLATFORM);
  rmSync(PLATFORM_BAK, { force: true });
  console.log('  已恢复 platform/index.ts');

  try { edge?.kill(); } catch { /* ignore */ }
  try { rmSync(PROFILE, { recursive: true, force: true }); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode ?? 0), 500);
}
