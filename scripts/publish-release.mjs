/**
 * 创建 / 更新 GitHub Release
 *
 *   node scripts/publish-release.mjs
 *
 * 为什么单独写这个脚本：
 *   1. 附件名不能用中文 —— GitHub 上传时会把中文吃掉
 *      （实测「人情账-0.2.3-release.apk」变成「-0.2.3-release.apk」，
 *       「人情账.html」变成「default.html」）。所以本地用英文名上传。
 *   2. 需要 token。从 Windows 凭据管理器取（git push 用的那份），
 *      不用额外配置环境变量。
 *
 * 前置：tag 已推送到远程。
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO = 'TTNAN/renqing-ledger';
const TAG = process.env.RELEASE_TAG || 'v0.3.0';

/* 附件：本地路径 → 上传到 GitHub 用什么名字（必须纯 ASCII） */
const UPLOAD_DIR = 'E:\\renqing-release-upload';
const ASSETS = [
  ['RenqingLedger-0.3.0-setup.exe', 'Windows 安装包（NSIS，当前用户安装）'],
  ['RenqingLedger-0.3.0-release.apk', 'Android 签名包（v2+v3）'],
  ['RenqingLedger-0.3.0-debug.apk', 'Android 调试包'],
  ['RenqingLedger-0.3.0.html', '单文件版（双击即用）'],
];

/* ---------------------------------------------------------------- 取 token */

function getToken() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  const out = execSync('git credential fill', {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error('没能从凭据管理器取到 token');
  return m[1].trim();
}

const TOKEN = getToken();
const H = {
  'User-Agent': 'renqing-ledger-release',
  Authorization: `token ${TOKEN}`,
  Accept: 'application/vnd.github+json',
};

async function api(path, init = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...H, ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : null;
}

/* ---------------------------------------------------------------- 正文 */

const BODY = `完全离线的中国家庭礼金账本。记下谁家办事我随了多少、谁来随过我多少 —— 下次对方办事，一查就知道该回多少。

**数据只存在你自己设备上：不联网、不上传、不需要账号。**

---

## 下载

| 平台 | 文件 | 说明 |
|---|---|---|
| **Android** | \`RenqingLedger-0.3.0-release.apk\` | 4.3 MB，v2+v3 签名 |
| **Windows** | \`RenqingLedger-0.3.0-setup.exe\` | 80.7 MB，当前用户安装，不需要管理员权限 |
| **任意平台** | \`RenqingLedger-0.3.0.html\` | 700 KB，双击即用，不用装任何东西 |

> 附件用英文名是为了避免 GitHub 处理中文文件名时出错。
> 装好后应用名仍然是「人情账」。

---

## ⚠️ 安装时会被拦，这是正常的

**Windows**：安装包没有代码签名证书（个人项目，证书要钱）。首次运行会弹「Windows 已保护你的电脑」：

> 点 **「更多信息」** → **「仍要运行」**

只在第一次需要这么做。

**Android**：自签名 APK 会提示「未知来源应用」，允许一次即可。

---

## 三种形态互相独立

**它们各自一本账，数据不互通。** 换设备靠备份文件迁移：

\`\`\`
旧设备 → 设置 → 导出全库备份（.json）
      → 传到新设备
新设备 → 从备份恢复 → 选那个文件
\`\`\`

**卸载前请先导出备份。** 安卓卸载会连数据一起删掉。

---

## 这个版本有什么

**账本核心**

- 13 种场次类型（结婚、满月、乔迁、白事……）
- 以「一户人家」为单位，支持别名 —— 搜「三舅」能找到「张叔」
- 软删除，统计自动排除但历史仍可追溯

**还礼建议（核心功能）**

- 纯函数实现，73 个单元测试覆盖
- **永远展示计算依据**，不给黑箱数字
- 白事走独立规则，不自动加码
- 净往来为正时抬高下限，可配置年份上浮与取整

**礼簿导出**

- **三端都能导出**：存 PDF、存图片（PNG），手机上也能用
- 超过 22 笔自动分页，每页带表头，合计只在最后一页
- 屏幕预览即最终效果，三端导出长得完全一样
- 电脑与浏览器另有系统打印（手机没有打印子系统）

**隐私**

- 不发起任何网络请求、无账号、无统计 SDK
- 日志不打印姓名与金额
- 可选应用锁（Argon2id + AES-GCM）
- 安卓关闭了系统自动备份，数据不会被传到 Google Drive

**体验**

- 金额支持中文习惯与小数：\`800\`、\`800元\`、\`800.50\`、\`捌佰\`、\`一千二\`
- 录入流程：场次 → 对方 → 金额 → 回车（手机上是「保存并继续」按钮）
- 大字号模式、手机底部导航、触控目标 ≥44px
- 一键载入虚构示例账本

---

## 已知限制

- **APK 未在真机上安装过**：开发环境没有 Android 模拟器镜像，安卓侧验证是在 390×844 视口下模拟 WebView 完成的
- **Windows 安装包未签名**：会被 SmartScreen 拦截，见上文
- **导出的 PDF 是图片型**：文字不可选、不可搜索（为了不嵌中文字库，否则体积翻几倍），打印与阅读完全正常
- Electron 产物 80 MB（自带 Chromium）

---

## 许可

MIT

示例账本中的人名、金额、地点均为虚构，与任何真实人物无关。

---

**完整更新历史见 [CHANGELOG.md](https://github.com/${REPO}/blob/main/CHANGELOG.md)。**
`;

/* ---------------------------------------------------------------- 主流程 */

console.log(`\n发布 ${TAG} 到 ${REPO}\n`);

/* 确认 tag 在远程存在 */
try {
  await api(`/repos/${REPO}/git/ref/tags/${TAG}`);
  console.log(`  ✓ tag ${TAG} 已存在于远程`);
} catch {
  console.error(`  ✗ 远程没有 tag ${TAG}，先 git push origin ${TAG}`);
  process.exit(1);
}

/* 删掉同名旧 release（如果有） */
try {
  const old = await api(`/repos/${REPO}/releases/tags/${TAG}`);
  if (old) {
    console.log(`  删除同名旧 release id=${old.id}`);
    await api(`/repos/${REPO}/releases/${old.id}`, { method: 'DELETE' });
  }
} catch {
  /* 没有旧的就继续 */
}

/* 创建 */
const release = await api(`/repos/${REPO}/releases`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tag_name: TAG,
    name: `人情账 ${TAG.replace(/^v/, '')}`,
    body: BODY,
    draft: false,
    prerelease: false,
  }),
});
console.log(`  ✓ Release 已创建: ${release.html_url}`);

/* 上传附件 */
for (const [file, note] of ASSETS) {
  const p = join(UPLOAD_DIR, file);
  if (!existsSync(p)) {
    console.warn(`  ⚠ 跳过 ${file}（本地不存在）`);
    continue;
  }

  const data = readFileSync(p);
  const mb = (statSync(p).size / 1024 / 1024).toFixed(1);
  process.stdout.write(`  上传 ${file}（${mb} MB）… `);

  const uploadUrl =
    `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets` +
    `?name=${encodeURIComponent(file)}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...H,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(data.length),
    },
    body: data,
  });

  if (!res.ok) {
    console.log('✗ ' + res.status + ' ' + (await res.text()).slice(0, 200));
    continue;
  }
  const asset = await res.json();
  console.log(`✓ ${(asset.size / 1024 / 1024).toFixed(1)} MB · ${note}`);
}

/* 汇总 */
const final = await api(`/repos/${REPO}/releases/tags/${TAG}`);
console.log(`\n  最终附件（${final.assets.length} 个）：`);
for (const a of final.assets) {
  console.log(`    ${a.name.padEnd(40)} ${(a.size / 1024 / 1024).toFixed(1)} MB  ↓${a.download_count}`);
}
console.log(`\n  ${final.html_url}\n`);
