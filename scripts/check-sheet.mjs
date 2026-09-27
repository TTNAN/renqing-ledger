/**
 * 验证礼簿在手机视口下的显示与导出
 *
 *   node scripts/check-sheet.mjs
 *
 * 覆盖少爷反馈的两个问题：
 *   1. 礼簿弹窗在手机上左右显示不全（表格被 560px 撑爆）
 *   2. 手机端生成礼簿要能存 PDF 与图片
 *
 * 做法：390×844 手机视口打开应用 → 载入示例 → 进场次 → 生成礼簿，
 * 量表格的实际宽度与是否溢出，并检查导出按钮是否都在。
 */
import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EDGE =
  process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9550;
const PROFILE = ROOT + '.sheet-check-profile';
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

  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });

  console.log('\n===== 礼簿手机端检查（390×844） =====\n');

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
      const out = {};

      for (let i = 0; i < 100; i++) {
        if (q('.app') && !q('.loading')) break;
        await sleep(150);
      }

      // 载入示例
      const seed = byText('button', '载入示例账本');
      if (seed) { click(seed); await sleep(1800); }

      // 进场次
      location.hash = '#/events';
      await sleep(1200);

      // 找「我家办事」的场次（那种才有礼簿按钮）
      const items = qa('.list-item');
      out.eventCount = items.length;
      // 直接进第一个场次
      if (items[0]) { click(items[0]); await sleep(1400); }

      // 找礼簿按钮
      const ledgerBtn = byText('button', '礼簿');
      out.hasLedgerBtn = !!ledgerBtn;
      if (ledgerBtn) { click(ledgerBtn); await sleep(1400); }

      const modal = q('.modal');
      out.modalOpen = !!modal;

      /*
       * 预览现在是 Canvas 渲染的图片（.sheet-preview），
       * 不再是 HTML 表格 —— 这样屏幕/打印/导出三处一致。
       * 所以要等图片渲染出来（异步），再量它的尺寸。
       */
      for (let i = 0; i < 40; i++) {
        if (q('.sheet-preview-page')) break;
        await sleep(150);
      }

      const sheet = q('.sheet-preview-page');
      if (sheet) {
        const sRect = sheet.getBoundingClientRect();
        const wrap = q('.modal-body');

        out.viewportWidth = window.innerWidth;
        out.sheetWidth = Math.round(sRect.width);
        out.sheetHeight = Math.round(sRect.height);
        out.modalBodyScrollW = wrap ? wrap.scrollWidth : 0;
        out.modalBodyClientW = wrap ? wrap.clientWidth : 0;
        /* 是否横向溢出：内容比容器宽就是溢出 */
        out.overflowX = wrap ? (wrap.scrollWidth > wrap.clientWidth + 1) : false;
        /* 图片是否超出视口 */
        out.sheetOverflows = sRect.right > window.innerWidth + 1;
        out.fitsInViewport = sRect.left >= -1 && sRect.right <= window.innerWidth + 1;
        out.pageCount = qa('.sheet-preview-page').length;
      }

      // 导出按钮
      out.buttons = qa('.modal-foot button').map(b => (b.textContent || '').trim());
      out.hasPdf = out.buttons.some(t => t.includes('存 PDF'));
      out.hasImg = out.buttons.some(t => t.includes('存图片'));
      out.hasPrint = out.buttons.some(t => t === '打印');

      return out;
    })()
  `);

  console.log('  【礼簿预览】');
  console.log(`    打开成功:        ${r.modalOpen ? '✓' : '★ 否'}`);
  console.log(`    视口宽度:        ${r.viewportWidth ?? '—'}px`);
  console.log(`    预览图宽度:      ${r.sheetWidth ?? '—'}px`);
  console.log(`    预览图高度:      ${r.sheetHeight ?? '—'}px`);
  console.log(`    页数:            ${r.pageCount ?? '—'}`);
  console.log(`    横向溢出:        ${r.overflowX ? '★ 是（有内容被裁）' : '✓ 否'}`);
  console.log(`    图片在视口内:    ${r.fitsInViewport ? '✓ 是' : '★ 否'}`);
  console.log('');
  console.log('  【导出按钮】');
  console.log(`    按钮列表:        ${(r.buttons || []).join(' / ')}`);
  console.log(`    有「存 PDF」:     ${r.hasPdf ? '✓' : '★ 否'}`);
  console.log(`    有「存图片」:     ${r.hasImg ? '✓' : '★ 否'}`);
  console.log(`    有「打印」:       ${r.hasPrint ? '✓（浏览器/桌面应有）' : '（手机端没有，此处是浏览器）'}`);
  console.log('');

  /*
   * 注意：这个脚本跑在普通浏览器里，
   * platform() 会判成 browser，所以「打印」按钮出现是对的。
   * 手机端（安卓）不显示打印按钮 —— 那条分支不在浏览器里可验，
   * 只能靠读代码与构建产物确认。
   */
  const pass =
    r.modalOpen &&
    !r.overflowX &&
    r.fitsInViewport &&
    (r.pageCount ?? 0) > 0 &&
    r.hasPdf &&
    r.hasImg;

  console.log('  ' + '='.repeat(44));
  console.log(`  ${pass ? '✅ 全部通过' : '❌ 有问题'}`);
  console.log('  ' + '='.repeat(44) + '\n');

  exitCode = pass ? 0 : 1;
} catch (err) {
  console.error('❌ ' + (err instanceof Error ? err.message : String(err)));
  exitCode = 2;
} finally {
  try { edge.kill(); } catch { /* ignore */ }
  setTimeout(() => process.exit(exitCode), 400);
}
