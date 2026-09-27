/**
 * 把 CI 工作流里的 pnpm 版本从 9 改成 11
 *
 * 为什么必须改：
 *   pnpm-lock.yaml 是 lockfileVersion 9.0，由本机 pnpm 11 生成。
 *   而 CI 里写的是 version: 9，会装 pnpm 9。
 *   两个大版本对 lockfile 的处理有差异，`--frozen-lockfile` 可能直接失败
 *   —— 这就是三个徽章全红的原因之一。
 *
 *   统一成与本地一致的 pnpm 11，CI 与本地行为才一致。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, '.github', 'workflows');

for (const f of readdirSync(DIR)) {
  if (!f.endsWith('.yml') && !f.endsWith('.yaml')) continue;
  const p = join(DIR, f);
  const before = readFileSync(p, 'utf8');

  /*
   * 匹配 pnpm/action-setup 的 with.version。
   * 注意不能全局替换 "version: 9" —— node-version / java-version 也含这个词。
   */
  const after = before.replace(
    /(- uses: pnpm\/action-setup@v4\s*\n\s+with:\s*\n\s+version:\s*)9(\s*\n)/g,
    '$111$2',
  );

  if (after !== before) {
    writeFileSync(p, after, 'utf8');
    console.log(`  ✓ ${f}`);
  } else {
    console.log(`  · ${f} 无需改动`);
  }
}
