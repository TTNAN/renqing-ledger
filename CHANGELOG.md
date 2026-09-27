# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.3] - 2026-09-26

换成设计给的正式图标，并修掉一个「图标被静默覆盖」的构建缺陷。

### 新增：正式图标素材

素材来自 `icons_renqingzhang.zip`，两套各 5 个尺寸（64/128/256/512/1024）：

| 素材 | 用途 | 风格 |
|---|---|---|
| `app_icon_*.png` | iOS / Android | 卡通风，主体大，小尺寸辨识度高 |
| `desktop_icon_*.png` | Windows | 写实风，留白多 |

素材已整理进 `assets/icons/source/` 随仓库走 ——
别人 clone 后能直接重新生成各平台图标，不用另外去要源文件。

**实测确认素材符合要求**（`pnpm icons:analyze`）：

```
尺寸        全部正方形（64/128/256/512/1024）
四角 alpha  255（不透明，满幅直角）
上边缘      第一个不透明像素 x=0
透明像素    0%
```

即：**素材本身是直角正方形，没有预先做圆角**。
生成脚本据此只做「缩放 + 打包」，绝不加圆角、不裁剪、不加阴影 ——
圆角交给各平台自己处理（Android 系统遮罩 / iOS 圆角遮罩 / Windows 任务栏）。

### 新增：图标生成脚本

`scripts/make-icons-from-source.mjs` —— 零依赖，自己实现了 PNG 编解码与
双线性缩放（不引 sharp / canvas 之类的原生库）：

- `build/icon.ico` —— Windows，7 个尺寸，用 desktop_icon
- `android-res/mipmap-*/` —— 5 种密度 × 3 个图标（传统 / 圆形 / 自适应前景）
- `android-res/values/ic_launcher_background.xml` —— 背景色取自素材四角
- `android-res/drawable-*/splash.png` —— 9 张启动画面

**自适应图标的前景层**会缩到画布 66% 并居中留透明边距：
系统只保证中间 72dp 可见，不留边距会被裁掉一圈。
脚本自带校验，生成后会读回产物确认四角仍是 alpha=255（未被加圆角）。

### 修复：图标被静默覆盖

`build-release.mjs` 第 189 行硬编码调的是**旧的占位图标脚本**，
于是 `pnpm build:all` 里「生成正式图标 → 被占位图标覆盖」，
打出来的 exe 里嵌的还是那个墨绿底红十字的占位图 ——
而且构建日志一切正常，完全看不出来。

**这个 bug 之所以能发现，是因为我把 exe 里的图标提取出来看了一眼**
（`Icon.ExtractAssociatedIcon`）。文件大小对不上（6.2 KB vs 207.8 KB）才暴露。

修法：

1. 正式素材优先，占位兜底 —— 顺序反了就会覆盖
2. `build-android.mjs` 原来只是「复制 `android-res/`」，
   素材更新了却忘了重跑图标脚本就会把旧图标打进 APK。
   现在构建时**主动重新生成一次**
3. `build:win` 同样改为正式素材优先

### 验证

三份产物均重新构建，并**逐个提取内嵌图标确认**：

| 产物 | 验证方式 | 结果 |
|---|---|---|
| exe | `Icon.ExtractAssociatedIcon` 提取后看图 | ✓ desktop_icon（金蝴蝶结） |
| APK | 解包取 `mipmap-xxxhdpi/ic_launcher.png` | ✓ app_icon（卡通风） |
| APK 启动图 | 解包取 `drawable-land-xxxhdpi/splash.png` | ✓ 1920×1280，图标居中 |
| exe 版本信息 | `VersionInfo` | ✓ 产品名「人情账」，0.2.2 |

图标变大导致产物略微增大：APK 2.8 → 3.7 MB，exe 83.8 → 84.2 MB。

## [0.2.2] - 2026-09-26

补上 0.2.1 的**发布流程漏洞**：修好的 bug 只在 exe 和 APK 里生效，
`人情账.html` 忘了重新生成，单文件版仍停留在旧代码上。

### 问题

三种形态是同一套前端的三份产物：

| 产物 | 构建命令 |
|---|---|
| `dist/` | `pnpm build` |
| `人情账.html` | `pnpm build:single` |
| exe / apk | `pnpm build:win` / `pnpm build:android` |

0.2.1 修完「首次点击无反应」后，我只重打了 exe 和 APK，
`人情账.html` 还是 9/23 的旧版 —— **那个 bug 在单文件版上依然存在**。

根因是流程问题，不是代码问题：**靠人记住「三份都要重打」是会漏的**。

### 修复

**1. 新增一键构建 `pnpm build:all`**

一条命令产出全部三份产物，并在结尾明确列出每份的大小与路径。
如果某份没产出来会显式提示，缺单文件 HTML 直接报错退出。

**2. 新增发版验证 `pnpm verify`**

依次跑：类型检查 → 单测 → 首次点击回归（http）→ 首次点击回归（单文件 file://）
→ 安卓容器 E2E → 桌面 E2E → 浏览器 E2E，最后汇总。

**3. 新增单文件版回归测试**

`scripts/verify-single-fix.mjs` —— 在 `file://` 下（即双击场景）
验证 9 个入口首次点击 + 完整主流程。
之前的 `verify-quickadd-fix.mjs` 只测了 `http://`，**所以漏掉了单文件版**。

**4. APK 资源校验**

Gradle 增量构建会复用旧 APK（时间戳不变），光看文件时间会误判成「没构建」。
现在构建后直接读 APK 里的 JS 文件名，与 `dist/` 比对：
不一致就报错退出，绝不默默产出旧代码的包。

### 顺带修掉的构建脚本问题

打包过程中发现 `pnpm build:all` 里的 Windows 步骤一直静默失败，追下去是三层坑叠加：

1. **`pnpm exec electron-builder`** 参数被吞 → 打印帮助并 **exit 0**（看起来像成功）
2. **`execSync(字符串, { shell: true })`** 参数要过 `cmd` 重新解析，`--win --x64 --dir` 同样被吞
3. **`spawnSync(process.execPath, ...)`** 在 DSH / Electron 宿主里经 pnpm 运行时，
   `process.execPath` 指向的是**宿主自己的 exe**（如 `DSH Desktop.exe`）而不是 node，
   于是变成「宿主程序执行 cli.js」，报错信息里诡异地出现宿主程序名

最终解法：显式找一个可信的 node（`npm_node_execpath` → `NODE_BINARY` → 名字像 node 的 `execPath` → PATH），
再用 `spawnSync` 传参数数组、不经 shell。并且**除了看退出码，还要检查输出里有没有 `Commands:` 帮助文本**——
「打印帮助然后正常退出」是最阴险的失败方式。

exe 图标注入也加了「被占用时重试」，不再因为上一次测试的 Electron 进程没退干净就整个构建失败。

### 验证

| 层次 | 结果 |
|---|---|
| 单元测试 | 32/32 |
| 类型检查 | 零错误 |
| **单文件版首次点击（file://）** | **9/9 + 主流程 5/5** |
| http 版首次点击 | 9/9 + 4/4 |
| 安卓容器 E2E | 13/13 |
| 桌面 E2E | 12/12 |
| 浏览器 E2E | 26/26 |
| APK 资源一致性 | 两份均通过 |

三份产物已用同一份代码重新构建。

## [0.2.1] - 2026-09-23

修复「首次打开点『记一笔』没有任何反应」——一个让应用看起来像坏了的严重 bug。

### 问题现象

刚打开软件（本地还没有任何数据时），点「记一笔」页面**一片空白**，
顶栏和底部导航还在，中间什么都没有。必须先做点别的（比如载入示例账本）才能进去。

### 根因

`QuickAddPage` 里有一句：

```tsx
if (!ledger) return null;   // ← 整页渲染成空
```

而 `boot()` 在首次打开时是这样写的：

```ts
const data = await repo.loadLedger();   // 没数据 → null
set({ ledger: data, ... });             // 把 null 存进了 state
```

于是 `ledger` 是 `null`，页面 `return null`，**React 渲染出一个空 div**，
既不报错也不跳转，用户只能看到空白。

「先点菜单再点就好」是因为**载入示例账本**之后 `ledger` 才有值。

同一个写法在 **5 个页面、共 8 处**：
`QuickAddPage`、`EventsPage`(×2)、`ContactsPage`(×2)、`SettingsPage`、`StatsPage`。

### 修复

**从源头解决，而不是在每个页面各自防御：**

1. `boot()` / `unlock()` / `wipe()` 一律兜底成 `repo.emptyLedger()`，
   **`ledger` 从此永不为 `null`**。页面拿到的永远是可用数据结构
2. 兜底的空账本**不写盘** —— 用户没记东西就不该产生文件
3. 新增 `isEmptyLedger()` 判断「还什么都没记」，
   首页靠它显示引导（不能用 `!ledger`，那判断的是「没就绪」）
4. 8 处 `return null` 全部换成 `<LedgerNotReady />` 组件：
   显示一句能看懂的提示 + 「回首页」「去设置」两个出口。
   **任何「什么都不显示」的路径，对用户来说都等于「这软件坏了」**

### 顺带修复的可用性问题

空账本的首页原本只有「记第一笔」和「载入示例账本」两个按钮，
用户想先**建场次**或**查还礼**时找不到入口。
现在空状态补上了「查还礼」「新建场次」「看户头」三个次级入口。

### 新增回归测试

`scripts/verify-quickadd-fix.mjs` —— 从**全新空账本**开始，
逐个验证 9 个入口首次点击都能正确跳转，并检查页面非空。

覆盖：顶栏记一笔 / 首页记第一笔 / 底部导航记一笔 /
首页查还礼 / 首页新建场次 / 顶部四个导航。

修复前后对比（同一脚本）：

| 入口 | 修复前 | 修复后 |
|---|---|---|
| 顶栏「记一笔」 | `.main` 空 | ✅ 渲染「记一笔」 |
| 首页「记第一笔」 | `.main` 空 | ✅ 渲染「记一笔」 |
| 底部导航「记一笔」 | `.main` 空 | ✅ 渲染「记一笔」 |

### 验证

| 层次 | 结果 |
|---|---|
| 单元测试 | 32/32 |
| 类型检查 | 零错误 |
| 首次点击回归 | **9/9**（修复前关键 3 项全挂） |
| 浏览器 E2E | 26/26 |
| 桌面 E2E | 12/12 |
| 安卓容器 E2E | 13/13 |

安装包与 APK 已用修复后的代码重新构建。

## [0.2.0] - 2026-09-23

给同一套前端加上 **Windows 安装包** 与 **Android APK**，业务逻辑未改动。

### 技术路线

环境里没有 Rust 与 MSVC 工具链（且当前账户非管理员，装不了），
所以走**路线 B**：

| 目标 | 方案 | 产物 |
|---|---|---|
| Windows | Electron 33 + electron-builder | `RenqingLedger-Setup-0.2.0.exe`（79.8 MB，NSIS） |
| Android | Capacitor 6 + Gradle | `人情账-0.2.0-{debug,release}.apk`（3.6 / 2.8 MB） |

前端仍是同一个 Vite 应用，`pnpm dev` 的纯浏览器开发模式完全不受影响。

### 新增：平台适配层 `src/platform/`

把「平台差异」关在一个门后面，业务代码零改动：

- `saveTextFile` / `pickTextFile` 按平台分流
  - 桌面 → 系统「另存为」/ 打开对话框
  - 安卓 → 写 `文档/RenqingLedger/`，失败退回系统分享；导入走 SAF
  - 浏览器 → Blob 下载 / `<input type=file>`
- `getDataLocation()` 让设置页显示**真实路径**
- `revealDataFolder()` / `chooseBackupDir()` 桌面端可打开数据目录、改备份位置
- **降级永远可用**：原生桥不在时自动回落浏览器实现
- Capacitor 相关代码全部动态 import，浏览器版会 tree-shake 掉

### 新增：Electron 桌面壳

- 数据放 `%APPDATA%\RenqingLedger\`，**不写进安装目录**
- `contextIsolation: true`，preload 只暴露 8 个方法
- 窗口大小/位置记忆，最小 1000×700
- 单实例锁；外部链接交给系统浏览器
- 精简中文菜单（含「打开数据文件夹」「打开备份文件夹」）
- 未配置代码签名，SmartScreen 会拦，README 说明了如何继续

### 新增：Capacitor Android 工程

- `applicationId` = `com.renqingledger.app`，显示名「人情账」
- minSdk **24**（需求指定），targetSdk **34**，竖屏优先、平板横屏可用
- **只申请 INTERNET 一条权限**（Capacitor 桥接所需，不用于上传账本）
- `allowBackup=false` + 空 `data_extraction_rules`：
  关掉系统自动备份，账本不会被传到 Google Drive
- 底部 4 入口导航（首页/记一笔/还礼/我的），适配刘海屏安全区
- 物理返回键：二级页返回、首页再按一次退出
- 签名从环境变量或 `keystore.properties` 读，密钥不入库

### 新增：图标与启动画面

零依赖手写 PNG 编码器生成（`scripts/make-icons.mjs`）：

- `build/icon.ico` —— 16/24/32/48/64/128/256 七种尺寸
- 安卓各密度 `ic_launcher` / `ic_launcher_round` / `ic_launcher_foreground`
- 各方向启动画面（9 种）
- 设计：墨绿圆角底 + 米白账本 + 朱红印章（「礼」字意象）

### 新增：UI 双端适配

- 手机单列布局，底部 4 入口导航（宽屏自动隐藏）
- **触控目标 ≥44px**（按钮/输入框/列表项/chip 全覆盖）
- 金额输入框 `inputMode="decimal"`，手机弹数字键盘
- 输入框 `font-size: 16px` 起，避免 WebView 聚焦时自动放大
- 安全区适配：`env(safe-area-inset-bottom)` 用于底部导航与弹窗
- 平台感知文案：安卓写「保存备份到文件」，不出现 C 盘路径

### 新增：CI

- `test.yml` —— 每次 push/PR 跑单测与类型检查
- `build-windows.yml` —— tag 触发，产出 NSIS artifact
- `build-android.yml` —— tag 触发，有 secrets 打签名包，没有则打未签名包

### 新增：文档

- `docs/android-signing.md` —— 生成 keystore、环境变量注入、CI secrets、密钥保管
- README 增补「下载安装」「开发者：打包」「常见问题」三章
- ARCHITECTURE.md 增加 platform 层与打包章节

### 修复（打包过程中发现的真实问题）

- **Electron 二进制残缺**：pnpm 安装的 Electron 缺 `ffmpeg.dll` 与 `libGLESv2.dll`
  （26 个文件 vs 完整 73 个），启动报 `0xC0000135`。
  改为从镜像直接下载完整 zip 解压
- **`app.getPath('userData')` 用了 package.json 的 name**，
  导致数据落在 `renqing-ledger` 而非 `RenqingLedger`。改为 `app.setName` + `setPath`
- **签名 storeFile 路径解析错误**：Gradle 的 `file()` 相对模块目录（`android/app/`），
  而配置里写的是相对 `android/`。改用 `rootProject.file()`
- **顶栏「记一笔」按钮在手机上只有 40px**，不达 44px 触控标准
- **winCodeSign 解压失败**：该包含 macOS 符号链接，非管理员账户无法创建。
  关掉 `signAndEditExecutable`，改用 rcedit 在打包后补图标与版本信息
- **NSIS 工具链下载走 GitHub 直连**（app-builder 不读镜像环境变量），
  国内 443 超时。新增 `scripts/prepare-builder-cache.mjs` 预置缓存

### 验证

| 层次 | 结果 |
|---|---|
| 单元测试 | 32/32（还礼算法未被破坏） |
| 类型检查 | 零错误 |
| 浏览器 E2E | 26/26 |
| 单文件 E2E | 9/9 |
| **桌面 E2E**（启动打包好的 exe） | **12/12** |
| **安卓容器 E2E**（手机视口） | **13/13** |

四个 E2E 都断言还礼建议为 `¥1,100 – ¥1,300`，与打包前一致。

### 已知限制

- **未在真机 / 模拟器上安装过 APK**：本机没有 Android 模拟器镜像，
  安卓侧验证是在 390×844 视口下模拟 WebView 环境完成的
- **Windows 安装包未做签名**：SmartScreen 会拦，README 说明了如何继续
- Electron 产物 80 MB（自带 Chromium）；在意体积可改用 Tauri 2，但需 Rust 工具链

## [0.1.1] - 2026-09-23

修复「双击 HTML 打开是空白」的问题，并新增单文件发行版。

### 新增

- **单文件版**：`pnpm build:single` 产出 `人情账.html`（约 660 KB），
  把 JS 与 CSS 全部内联，双击即可使用，不需要 Node、不需要起服务器。
  经 `file://` 协议实测：IndexedDB 可持久化、WebCrypto 可用，**能真正存住数据**
- 构建脚本新增三道自检：无外部引用 / 全部为经典脚本 / 内联脚本语法正确
- 新增 `scripts/e2e-single.mjs`：用 `file://` 协议跑主流程，验证「双击场景」
- 新增 `scripts/diag-blank.mjs`、`scripts/diag-file-storage.mjs` 诊断脚本

### 修复

- **双击白屏**：常规构建产出 `<script type="module">`，而浏览器规定
  ES Module 不能用 `file://` 加载（origin 为 null 被 CORS 拦截）。
  单文件版改用 IIFE 格式并把资源全部内联，绕开该限制
- **脚本执行时机**：Vite 把入口放在 `<head>`，靠 `type="module"` 的 defer 语义等 DOM 就绪。
  改成经典脚本后 defer 失效，会报「找不到 #root 节点」。
  现在统一把脚本插到 `</body>` 之前
- **`$&` 替换陷阱**：内联时用字符串作为 `String.replace` 的替换值，
  其中的 `$&` 会被展开成匹配文本，而压缩代码里恰好有 `$&&` 这种写法
  （变量名叫 `$`），导致产物被改坏（`Q===$&&` → `Q===</body>&`）。
  改用函数替换器与字面量拼接
- **README 说清怎么打开**：明确区分源码入口 `index.html`（给 `pnpm dev` 用）
  与构建产物，并提醒移动单文件会因浏览器按路径隔离存储而「看起来数据没了」

## [0.1.0] - 2026-09-23

首个 MVP。目标是把「记礼金 → 查还礼 → 备份」这条主线跑通。

### 新增

**账本核心**
- 场次管理：13 种类型（结婚/满月/百日/周岁/生日寿宴/乔迁/开业/升学/金榜/探病/白事/节日/其他），
  区分「我家办事」与「对方家办事」，支持地点与备注
- 对方户头：以「一户人家」为单位，支持称呼、姓名、**别名**、关系、家庭分支、电话、备注
- 账目条目：随出/收来双方向，礼金/礼物/两者兼有，支付方式、经手人、备注
- 全部删除均为软删除（`deleted_at`），统计自动排除，历史仍可追溯

**还礼建议（核心）**
- 纯函数实现（`src/domain/suggest.ts`），不依赖 React 与数据库，可独立测试
- 规则：同类历史优先 → 对方最近随来 → 我最近随出；净往来为正时不低于对方给的；
  白事走独立规则（不加码、不低于历史最低）；年份上浮；按档位取整；区间上下浮动一档
- **必须展示计算依据**：逐条列出用了哪年哪场哪笔记录，不给「黑箱数字」
- 支持「模拟还礼」：换类型即时重算，不写账
- 礼物估价默认不计入现金建议，只在依据里提一句

**查询与统计**
- 全局搜索：称呼、姓名、别名、家庭分支、备注、场次名
- 户头详情：累计随出 / 累计收来 / 差额 + 时间线 + 模拟还礼
- 户头合并：重复户头可合并，历史记录归到一户，原称呼自动变成别名
- 统计：年度收支、按类型、按关系、月度双色柱状图（Recharts），可切年份

**导出与打印**
- 礼簿生成：序号、称呼、备注、金额、合计，A4 打印样式（14pt 起，适合长辈阅读）
- 打印 / 存 PDF：走浏览器 print CSS，无额外依赖
- CSV 导出：全部条目、户头汇总，带 UTF-8 BOM，Excel 双击不乱码
- 全库 JSON 备份与恢复，支持加密备份

**隐私与安全**
- 纯本地：不发起任何网络请求，无账号系统，无第三方统计 SDK
- 可选应用锁：Argon2id 派生密钥（64 MiB / 3 轮）→ AES-GCM 加密整库，密码不落盘
- 自动备份：启动时每天一份，保留最近 20 份，可在设置页恢复或删除
- 日志不打印姓名与金额

**体验**
- 连续录入：保存后清空金额、焦点留在户头，回车即存下一笔，右上角实时累计
- 金额输入兼容中文习惯：`800`、`800元`、`捌佰`、`一千二`、`三块五`、`1万2`
- 边输入边建户头，键盘上下 + 回车即可选定
- 大字号模式（标准 / 大 / 特大）
- 空状态可一键载入虚构示例账本
- 删除一律二次确认
- 白事场次自动降低界面饱和色

### 技术

- React 18 + TypeScript 5.6（严格模式）+ Vite 5
- Zustand 4 状态管理，自写 hash 路由（免配置部署到 GitHub Pages）
- IndexedDB 单文档存储，备份/加密/恢复均为整体操作
- 金额全程整数分运算，`src/domain/money.ts` 是唯一出入口
- 日期统一 `YYYY-MM-DD`，按 Asia/Shanghai 取「今天」，用字符串比较排序避免时区陷阱
- 测试：Vitest，32 个用例（还礼算法 15 + 金额工具 17）
- 端到端：`scripts/e2e.mjs` 通过 CDP 驱动真实浏览器跑完整主流程（26 项检查）

### 已知限制

- 单文档存储，不适合十万条以上规模；届时可迁移到 SQLite（storage 层已隔离）
- 未做 Tauri 桌面壳，README 已说明套壳路径
- 加密账本忘记密码无法找回（本地加密的固有代价，界面已明确警示）
- 未实现微信聊天记录识别（路线图项，未开工）

### 依赖取舍说明

- **未使用 SheetJS (`xlsx`)**：npm 上的公开版本存在已知原型污染漏洞（CVE-2023-30533 等），
  且上游已迁移至自建源。MVP 改用「UTF-8 BOM + CSV」，Excel 双击直接正确打开中文，零依赖零风险。
- **未使用 react-router**：9 个平级页面用 60 行 hash 路由足够，产物更小且免 basename 配置。
- **未使用 sql.js / wa-sqlite**：个人账本量级下 IndexedDB 单文档更简单，且加密与备份都变成整体操作。
