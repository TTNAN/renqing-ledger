/**
 * 人情账 · 单文件构建
 *
 * 产出 `人情账.html`：把 JS 与 CSS 全部内联进一个 HTML，
 * 双击即可在浏览器里使用，不需要装任何东西、不需要起服务器。
 *
 *   pnpm build:single
 *
 * 为什么这样能行（都是实测过的，不是推测）：
 *   · 白屏根因是 ES Module 在 file:// 下被 CORS 拦截 → 改成 IIFE 经典脚本即可
 *   · IndexedDB 在 file:// 下可用且能跨页面持久化
 *   · WebCrypto（应用锁用的 AES-GCM）在 file:// 下可用（isSecureContext = true）
 *   · 应用本身不发任何网络请求，所以没有其他会被 CORS 拦的东西
 */
import { build } from 'vite';
import {
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist-single');

console.log('\n构建单文件版本…\n');

rmSync(DIST, { recursive: true, force: true });

await build({
  configFile: join(ROOT, 'vite.single.config.ts'),
  root: ROOT,
  logLevel: 'warn',
});

/* ---------------------------------------------------------------- 内联 */

const htmlPath = join(DIST, 'index.html');
let html = readFileSync(htmlPath, 'utf8');

/**
 * 内联到 HTML 里的脚本，唯一会提前闭合 <script> 标签的序列就是 `</script`。
 * 在 JS 里 `<\/script` 与 `</script` 完全等价（反斜杠转义斜杠），所以这样替换是安全的。
 *
 * 之前用 new RegExp('</' + tag, 'gi') 同时处理 script 和 style，
 * 结果把压缩代码里的 `Q===$` 之类也搅坏了 —— 现在只针对 script，且用字面量匹配。
 */
const guardScript = (code) => code.split('</script').join('<\\/script');

let inlinedCss = 0;
let inlinedJs = 0;

/* 内联 CSS。CSS 里不会出现 $& 语义问题（没有 replace 字符串值），
   但同样避免用字符串替换值以防万一。 */
html = html.replace(
  /<link[^>]*rel=["']stylesheet["'][^>]*>/gi,
  (tag) => {
    const href = /href=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) return tag;
    const file = join(DIST, href.replace(/^\.?\//, ''));
    if (!existsSync(file)) return tag;
    inlinedCss += 1;
    const css = readFileSync(file, 'utf8');
    // 函数替换器：返回值里的 $ 不会被当成替换符号
    return `<style>\n${css.split('</style').join('<\\/style')}\n</style>`;
  },
);

/* 内联 JS，并且去掉 type="module" —— 关键一步。
   注意：Vite 把入口脚本放在 <head> 里，靠 type="module" 的 defer 语义等 DOM 就绪。
   改成经典脚本后 defer 没了，脚本会在 #root 出现之前执行，报「找不到 #root 节点」。
   所以这里先收集脚本内容，稍后统一挪到 </body> 之前。 */
const scripts = [];
html = html.replace(
  /<script[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
  (tag, src) => {
    const file = join(DIST, src.replace(/^\.?\//, ''));
    if (!existsSync(file)) return tag;
    inlinedJs += 1;
    scripts.push(readFileSync(file, 'utf8'));
    return '<!--APP_SCRIPT_PLACEHOLDER-->';
  },
);

/* 加一点说明，让用户知道这是什么文件。
   注意：这里必须用「函数替换器」而不是字符串替换值 ——
   字符串替换值里的 $& / $' / $` 是特殊符号，会被展开成匹配文本，
   而压缩后的 JS 里恰好会有 `$&&` 这种写法（变量名叫 $），一旦被展开就会把代码改坏。 */
const replaceLiteral = (haystack, needle, value) =>
  haystack.split(needle).join(value);

html = replaceLiteral(
  html,
  '<div id="root"></div>',
  `<div id="root"></div>
    <noscript>
      <div style="padding:40px;font:16px/1.7 sans-serif;color:#24302c">
        <h2>需要开启 JavaScript</h2>
        <p>人情账是一个纯本地应用，全部逻辑在浏览器里运行，请在浏览器设置中允许 JavaScript。</p>
      </div>
    </noscript>`,
);

/* 把脚本插到 </body> 之前，保证 DOM（含 #root）已经就绪。
   同样用字面量拼接，避免 $ 被当成替换符号。 */
const scriptTags = scripts
  .map((js) => `<script>\n${guardScript(js)}\n</script>`)
  .join('\n');

html = replaceLiteral(html, '<!--APP_SCRIPT_PLACEHOLDER-->', '');
html = replaceLiteral(html, '</body>', `${scriptTags}\n  </body>`);

/**
 * 内联 favicon。
 *
 * 单文件版是给人双击打开的，而 file:// 下引用 ./favicon.ico 有两个问题：
 *   1. 浏览器可能不加载（同目录但 origin 为 null）
 *   2. 我们的自检会把它当成「外部引用」报警告
 * 所以直接把 32×32 那张塞成 data URL，彻底自包含。
 */
let inlinedIcon = 0;
html = html.replace(
  /<link[^>]*rel=["'](?:icon|apple-touch-icon)["'][^>]*>/gi,
  (tag) => {
    /* 优先用 32×32 的 PNG；找不到就退回 ico */
    const candidates = ['favicon-32.png', 'favicon.ico'];
    for (const name of candidates) {
      const p = join(ROOT, 'public', name);
      if (!existsSync(p)) continue;
      const mime = name.endsWith('.ico') ? 'image/x-icon' : 'image/png';
      const b64 = readFileSync(p).toString('base64');
      inlinedIcon += 1;
      /* 只保留第一个图标声明，其余丢掉 —— 一个 data URL 就够了 */
      return inlinedIcon === 1
        ? `<link rel="icon" type="${mime}" href="data:${mime};base64,${b64}">`
        : '';
    }
    return tag;
  },
);
if (inlinedIcon > 0) {
  console.log(`✓ 已内联 favicon（${inlinedIcon} 个声明）`);
}
html = html.replace(/\n\s*\n\s*\n/g, '\n\n');

/* 自检：确认没有残留的外部引用 */
const leftovers = [
  ...html.matchAll(/<(?:script|link)[^>]*(?:src|href)=["']([^"']+)["']/gi),
]
  .map((m) => m[1])
  .filter((u) => u && !/^(data:|https?:|#)/i.test(u));

if (leftovers.length > 0) {
  console.warn('⚠ 仍存在外部引用（可能导致 file:// 下白屏）：');
  for (const l of leftovers) console.warn('    ' + l);
} else {
  console.log('✓ 自检通过：没有任何外部引用，双击即可打开');
}

/* 自检：确认不是模块脚本 */
if (/<script[^>]*type=["']module["']/i.test(html)) {
  console.warn('⚠ 仍存在 type="module" 脚本，file:// 下会被拦截');
} else {
  console.log('✓ 自检通过：全部为经典脚本');
}

/* 自检：脚本必须在 #root 之后，否则会报「找不到 #root 节点」 */
const rootPos = html.indexOf('id="root"');
const scriptPos = html.lastIndexOf('<script>');
if (rootPos >= 0 && scriptPos >= 0 && scriptPos < rootPos) {
  console.warn('⚠ 脚本出现在 #root 之前，会在 DOM 就绪前执行');
} else {
  console.log('✓ 自检通过：脚本位于 #root 之后，DOM 已就绪');
}

/* 自检：把内联脚本抽出来做真正的语法检查。
   这一步是为了拦住「替换时把代码改坏」这类问题 ——
   曾经因为 replace 字符串值里的 $& 被展开，把 `$&&` 变成了 `</body>&`。 */
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].map(
  (m) => m[1],
);

let syntaxOk = true;
for (let i = 0; i < inlineScripts.length; i += 1) {
  const tmp = join(tmpdir(), `rqz-syntax-${process.pid}-${i}.js`);
  writeFileSync(tmp, inlineScripts[i], 'utf8');
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
  } catch (e) {
    syntaxOk = false;
    console.error(`✗ 第 ${i + 1} 个内联脚本语法检查失败：`);
    console.error(String(e.stderr || e.message).split('\n').slice(0, 6).join('\n'));
  }
  rmSync(tmp, { force: true });
}

if (syntaxOk) {
  console.log(`✓ 自检通过：${inlineScripts.length} 个内联脚本语法正确`);
} else {
  console.error('');
  console.error('构建产物有问题，不要分发这个文件。');
  process.exit(1);
}

/* ---------------------------------------------------------------- 输出 */

const outFile = join(ROOT, '人情账.html');
writeFileSync(outFile, html, 'utf8');
writeFileSync(htmlPath, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(0) + ' KB';

console.log('');
console.log('  内联 ' + inlinedJs + ' 个脚本、' + inlinedCss + ' 个样式表');
console.log('  ' + outFile + '  (' + kb(statSync(outFile).size) + ')');
console.log('  ' + htmlPath + '  (' + kb(statSync(htmlPath).size) + ')');
console.log('');
console.log('  双击「人情账.html」即可使用。数据存在浏览器本地，不联网。');
console.log('');

/* 提示：file:// 下数据是按「文件路径」隔离的 */
console.log('  注意：换一个位置存放这个文件，浏览器会当成新的存储空间，');
console.log('        账本看起来会是空的 —— 所以别随意移动它。');
console.log('        要搬家请先用「设置 → 导出全库备份」导出 JSON。');
console.log('');
