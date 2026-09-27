/**
 * 验证头像在各处的渲染
 *
 *   node scripts/check-avatar.mjs
 *
 * 背景：头像的圆角与居中原本只写在 `.list-item .avatar` 下，
 * 结果户头详情页的头像（不在列表项里）变成方形，字也偏了。
 * 这个脚本在真实浏览器里量各处头像的实际计算样式。
 */
import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EDGE =
  process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9541;
const PROFILE = ROOT + '.avatar-check-profile';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5273';

rmSync(PROFILE, { recursive: true, force: true });
if (!existsSync(EDGE)) {
  console.error('找不到 Edge');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const edge = spawn(
  EDGE,
  [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=' + PROFILE, 'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

async function waitTarget(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch { /* wait */ }
    await sleep(250);
  }
  throw new Error('DevTools 未就绪');
}

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params = {}, t = 90000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); }
      }, t);
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: expr, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result?.value;
  }
}

let exitCode = 1;

try {
  const target = await waitTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WS 失败')), { once: true });
  });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');

  console.log('\n===== 头像渲染检查 =====\n');

  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(2800);

  const r = await cdp.ev(`
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
      const out = [];

      for (let i = 0; i < 100; i++) {
        if (q('.app') && !q('.loading')) break;
        await sleep(150);
      }

      // 载入示例数据
      const seed = byText('button', '载入示例账本');
      if (seed) { click(seed); await sleep(1800); }

      // 量一个头像的实际样式
      const measure = (label, el) => {
        if (!el) { out.push({ place: label, found: false }); return; }
        const cs = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        out.push({
          place: label,
          found: true,
          radius: cs.borderRadius,
          display: cs.display,
          alignItems: cs.alignItems,
          justify: cs.justifyContent,
          lineHeight: cs.lineHeight,
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          text: (el.textContent || '').trim(),
        });
      };

      // 1. 首页 / 户头列表里的头像
      location.hash = '#/contacts';
      await sleep(1200);
      measure('户头列表', qa('.list-item .avatar')[0]);

      // 2. 点进某个户头详情
      const firstItem = qa('.list-item')[0];
      if (firstItem) { click(firstItem); await sleep(1300); }
      measure('户头详情', q('.avatar'));

      return out;
    })()
  `);

  console.log('  ' + '-'.repeat(92));
  console.log('  位置'.padEnd(14) + '圆角'.padEnd(14) + 'display'.padEnd(10) + '对齐'.padEnd(14) + '行高'.padEnd(10) + '尺寸');
  console.log('  ' + '-'.repeat(92));

  let allPass = true;
  for (const m of r) {
    if (!m.found) {
      console.log(`  ${m.place.padEnd(12)} ★ 没找到头像元素`);
      allPass = false;
      continue;
    }
    console.log(
      `  ${m.place.padEnd(12)} ${m.radius.padEnd(12)} ${m.display.padEnd(8)} ` +
        `${(m.alignItems + '/' + m.justify).padEnd(12)} ${m.lineHeight.padEnd(8)} ${m.w}×${m.h}  「${m.text}」`,
    );
    if (m.radius !== '50%') allPass = false;
    if (m.display !== 'flex') allPass = false;
    if (m.alignItems !== 'center' || m.justify !== 'center') allPass = false;
  }

  console.log('  ' + '-'.repeat(92));
  console.log(`  ${allPass ? '✅ 各处头像都是圆形且居中' : '❌ 有不一致的头像'}\n`);

  exitCode = allPass ? 0 : 1;
} catch (err) {
  console.error('❌ ' + (err instanceof Error ? err.message : String(err)));
  exitCode = 2;
} finally {
  try { edge.kill(); } catch { /* ignore */ }
  setTimeout(() => process.exit(exitCode), 400);
}
