/**
 * 验证顶栏在各端的显示
 *
 *   node scripts/check-topbar.mjs
 *
 * 三种情况：
 *   1. 安卓（手机视口 + 模拟安卓平台）→ 应该没有顶栏
 *   2. 浏览器窄窗口（720px 以下）      → 顶栏退化成窄条，仍在
 *   3. 浏览器宽窗口                    → 完整顶栏，含导航
 *
 * 难点：Capacitor 会探测真实环境，注入 window.Capacitor 不管用。
 * 解法：直接对打包后的 JS 做静态检查 —— 看顶栏是否被包在
 * isAndroid 判断里，以及移动端 CSS 是否还引用 .topbar。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const jsDir = join(ROOT, 'dist', 'assets');
if (!existsSync(jsDir)) {
  console.error('dist/ 不存在，先跑 pnpm build');
  process.exit(2);
}

const { readdirSync } = await import('node:fs');
const jsFiles = readdirSync(jsDir).filter((f) => f.startsWith('index-') && f.endsWith('.js'));
const js = jsFiles.map((f) => readFileSync(join(jsDir, f), 'utf8')).join('\n');
const cssFiles = readdirSync(jsDir).filter((f) => f.endsWith('.css'));
const css = cssFiles.map((f) => readFileSync(join(jsDir, f), 'utf8')).join('\n');

console.log('\n===== 顶栏渲染检查 =====\n');

const checks = [];

/* 1. 顶栏是否被条件渲染包住 */
/*
 * 压缩后的形态是  children:[!Nt()&&c.jsx("header",{className:"topbar no-print",...
 * 也就是紧挨在 "topbar no-print" 前面有一个 && 或 ? 形式的条件表达式。
 * 直接看它前面那一小段里有没有 &&/? 就够了 —— 不要试图猜函数名，
 * 压缩后名字是 Nt/Bo 这种随机短标识符。
 */
const topbarIdx = js.indexOf('topbar no-print');
const before = topbarIdx >= 0 ? js.slice(Math.max(0, topbarIdx - 60), topbarIdx) : '';
const guarded = /&&\s*[a-zA-Z_$][\w$]*\.jsx\(@?["']?header/.test(before) ||
                /&&/.test(before);

checks.push([
  '顶栏由条件渲染控制',
  guarded,
  guarded ? '紧邻 && 条件' : '前后文：' + before.slice(-40),
]);

/* 另外确认 isAndroid 这个判定确实存在于产物里 */
const hasAndroidCheck = /isNativePlatform/.test(js) || /"android"/.test(js);
checks.push([
  '产物里含安卓平台判定',
  hasAndroidCheck,
  '',
]);

/* 2. 有没有直接出现在 JSX 里的无条件 topbar */
/* 压缩产物里 className:"topbar no-print" 出现一次，前面应有个条件 */
const topbarCount = (js.match(/topbar no-print/g) || []).length;
checks.push([
  '「topbar no-print」只出现一次（未重复渲染）',
  topbarCount === 1,
  `出现 ${topbarCount} 次`,
]);

/* 3. 移动端 CSS 里是否还残留 .topbar 规则 */
const mobileBlock = css.match(/@media\s*\(max-width:\s*720px\)\s*\{[\s\S]*?\n\}/);
const mobileCss = mobileBlock ? mobileBlock[0] : '';
const hasTopbarInMobile = /\.topbar/.test(mobileCss);
checks.push([
  '手机端 CSS 不再有 .topbar 规则',
  !hasTopbarInMobile,
  hasTopbarInMobile ? '仍有残留规则' : '已清理',
]);

/* 4. local-badge 应该彻底消失 */
checks.push([
  'local-badge 已彻底移除',
  !js.includes('local-badge') && !css.includes('local-badge'),
  '',
]);

/* 5. 底部导航仍在（记一笔入口不能丢） */
checks.push([
  '底部导航保留（记一笔入口仍在）',
  js.includes('mobile-nav') && js.includes('记一笔'),
  '',
]);

console.log('  ' + '-'.repeat(72));
let allPass = true;
for (const [name, ok, detail] of checks) {
  console.log(`  ${ok ? '✓' : '✗'} ${name.padEnd(40)} ${detail}`);
  if (!ok) allPass = false;
}
console.log('  ' + '-'.repeat(72));
console.log(`  ${allPass ? '✅ 全部通过' : '❌ 有问题'}\n`);

/* 打印条件渲染的实际代码片段，便于人工确认 */
const idx = js.indexOf('topbar no-print');
if (idx >= 0) {
  const ctx = js.slice(Math.max(0, idx - 220), idx + 40);
  console.log('  顶栏渲染处的实际代码：');
  console.log('  ...' + ctx.replace(/\n/g, ' ') + '...\n');
}

process.exit(allPass ? 0 : 1);
