/**
 * 模拟「安卓字体更宽」的情况，验证称呼不被截断
 *
 *   node scripts/check-android-font.mjs
 *
 * 为什么要专门测这个：
 *   列宽如果只靠 measureText，就依赖当前环境加载的字体。
 *   桌面用 Microsoft YaHei，安卓用 Noto Sans CJK，字宽不同 ——
 *   电脑上量着刚好放得下，换到手机同一串字更宽就被截。
 *   这正是「电脑端没问题、手机端仍截断」的根因。
 *
 *   本脚本在页面里强行把字体指定成一串几乎不存在的名字，
 *   让浏览器回退到最宽的可用中文字体，模拟「比预期更宽」的情况。
 */
import { spawn } from 'node:child_process';
import { rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EDGE =
  process.env.EDGE_PATH ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PORT = 9570;
const PROFILE = ROOT + '.fontcheck-profile';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5273';
const OUTDIR = join(ROOT, 'font-check-samples');

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUTDIR, { recursive: true });

if (!existsSync(EDGE)) {
  console.error('找不到 Edge');
  process.exit(2);
}

const bundle = await build({
  configFile: false,
  logLevel: 'silent',
  build: {
    write: false,
    lib: {
      entry: join(ROOT, 'src/domain/sheetCanvas.ts'),
      formats: ['iife'],
      name: '__Sheet',
      fileName: 'sheet',
    },
    minify: false,
  },
});
const code = (Array.isArray(bundle) ? bundle[0] : bundle).output.find((o) => o.type === 'chunk').code;

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

try {
  const target = await waitTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('WS 失败')), { once: true });
  });
  const cdp = new CDP(ws);
  await cdp.send('Runtime.enable');

  await cdp.send('Page.navigate', { url: BASE + '/' });
  await sleep(2200);
  await cdp.ev(code + '\n; true;');

  console.log('\n===== 称呼列宽验证（含更宽字体场景） =====\n');

  const names = [
    '高中同学赵强',
    '初中同桌李娜',
    '大学室友王大力',
    '前同事兼邻居李经理',
    '三舅家的表姐陈小燕',
    '爱人的高中同学周老师',
    '张叔',
    '刘哥',
  ];

  const rows = names.map((n, i) => ({
    index: i + 1,
    name: n,
    amount: 80000,
    amountText: '800.00',
    note: '',
    method: '现金',
    handler: '',
  }));

  const sheetJson = JSON.stringify({
    title: '我家结婚',
    type: '结婚',
    dateText: '2021年10月2日',
    location: '老家礼堂',
    rows,
    totalCents: 80000 * 8,
    totalText: '¥6,400.00',
    count: 8,
    household: '爸妈',
  });

  /*
   * 渲染一页，然后逐行扫描：在称呼列应有的水平范围内，
   * 检查文字是否被画到了列外（说明溢出）或末尾有省略号。
   *
   * 更直接的办法：调渲染器内部逻辑拿不到，
   * 所以改为量「同样字号下，这段文字的实际宽度」与「列宽」的关系。
   */
  const analysis = await cdp.ev(`
    (() => {
      const sheet = ${sheetJson};
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';
      const SIZE = 16;

      // 量两个字体下的宽度：正常、以及回退到最宽的黑体
      const measure = (font) => {
        ctx.font = '600 ' + SIZE + 'px ' + font;
        const out = {};
        for (const n of sheet.rows) out[n.name] = Math.round(ctx.measureText(n.name).width);
        return out;
      };

      const normal = measure(FONT);
      // 强调字体名不存在，逼浏览器回退到系统默认黑体（通常更宽）
      const wide = measure('Nonexistent-Font-XYZ, "SimHei", "Noto Sans CJK SC", sans-serif');

      return { normal, wide };
    })()
  `);

  const { normal, wide } = analysis;

  /* 复算渲染器用的列宽逻辑（与 sheetCanvas 保持一致） */
  const PAGE_W = 794;
  const MARGIN_X = 62;
  const contentW = PAGE_W - MARGIN_X * 2;
  const COL_LIMIT = contentW * 0.42;

  const estimate = (s) => {
    let w = 0;
    for (const ch of s) {
      w += /[\u0000-\u00ff]/.test(ch) ? 16 * 0.58 : 16;
    }
    return w;
  };

  let maxNormal = 0;
  let maxWide = 0;
  let maxEstimate = 0;
  for (const n of names) {
    maxNormal = Math.max(maxNormal, normal[n] ?? 0);
    maxWide = Math.max(maxWide, wide[n] ?? 0);
    maxEstimate = Math.max(maxEstimate, estimate(n));
  }

  const colW = Math.min(Math.max(maxNormal, maxWide, maxEstimate) + 20, COL_LIMIT);

  console.log('  称呼'.padEnd(22) + '正常字体'.padEnd(12) + '宽字体'.padEnd(12) + '估算');
  console.log('  ' + '-'.repeat(58));
  for (const n of names) {
    console.log(
      `  ${n.padEnd(20)} ${String(normal[n]).padStart(6)}px    ${String(wide[n]).padStart(6)}px    ${String(estimate(n)).padStart(5)}px`,
    );
  }
  console.log('');
  console.log(`  最终列宽: ${Math.round(colW)}px（上限 ${Math.round(COL_LIMIT)}px）`);
  console.log(`  最宽称呼: 正常 ${maxNormal}px · 宽字体 ${maxWide}px · 估算 ${maxEstimate}px`);
  console.log('');

  /* 导出样张 */
  const dataUrl = await cdp.ev(`
    (() => {
      const sheet = ${sheetJson};
      const pages = __Sheet.paginateSheet(sheet);
      const canvas = __Sheet.renderSheetPage(sheet, pages[0], {
        household: sheet.household,
        totalText: sheet.totalText,
        totalCount: sheet.count,
      });
      return canvas.toDataURL('image/png');
    })()
  `);
  writeFileSync(
    join(OUTDIR, 'font-check-page.png'),
    Buffer.from(String(dataUrl).replace(/^data:image\/png;base64,/, ''), 'base64'),
  );
  console.log('  样张: font-check-samples/font-check-page.png');
  console.log('');

  /* 判定：列宽必须容得下最宽的称呼 */
  const ok = colW >= maxWide && colW >= maxNormal && colW >= maxEstimate;
  console.log('  ' + '='.repeat(48));
  console.log(`  ${ok ? '✅ 列宽容得下所有称呼（含更宽字体）' : '❌ 列宽不够'}`);
  console.log('  ' + '='.repeat(48) + '\n');

  process.exitCode = ok ? 0 : 1;
} catch (err) {
  console.error('❌ ' + (err instanceof Error ? err.message : String(err)));
  process.exitCode = 2;
} finally {
  try { edge.kill(); } catch { /* ignore */ }
  setTimeout(() => process.exit(process.exitCode ?? 0), 400);
}
