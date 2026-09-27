/**
 * 人情账 · 版本号统一更新
 *
 *   node scripts/bump-version.mjs 0.2.2
 *
 * 三处必须一致（需求要求），手工改容易漏：
 *   1. package.json         → version
 *   2. android/variables.gradle → appVersionName（同时递增 appVersionCode）
 *   3. electron-builder.yml 不用改（产物名用 ${version} 占位）
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('用法：node scripts/bump-version.mjs <x.y.z>');
  process.exit(1);
}

/* --- package.json --- */
const pkgPath = join(ROOT, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const prev = pkg.version;
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
console.log(`  package.json            ${prev} → ${next}`);

/* --- android/variables.gradle --- */
const gradlePath = join(ROOT, 'android', 'variables.gradle');
let gradle = readFileSync(gradlePath, 'utf8');

const codeMatch = gradle.match(/appVersionCode = (\d+)/);
const prevCode = codeMatch ? Number(codeMatch[1]) : 0;
const nextCode = prevCode + 1;

gradle = gradle.replace(/appVersionCode = \d+/, `appVersionCode = ${nextCode}`);
gradle = gradle.replace(/appVersionName = '[^']*'/, `appVersionName = '${next}'`);
writeFileSync(gradlePath, gradle, 'utf8');
console.log(`  android/variables.gradle   ${prevCode} → ${nextCode}（versionCode）`);
console.log(`                             ${next}（versionName）`);

/* --- electron-builder.yml 里若写死了版本，提示一下 --- */
const ebPath = join(ROOT, 'electron-builder.yml');
const eb = readFileSync(ebPath, 'utf8');
if (/version:\s*\d+\.\d+\.\d+/.test(eb)) {
  console.warn('  ⚠ electron-builder.yml 里写死了版本号，记得同步改');
} else {
  console.log('  electron-builder.yml       无需改（用 ${version} 占位）');
}

console.log('\n  下一步：pnpm build:all\n');
