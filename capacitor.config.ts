/**
 * Capacitor 配置
 *
 * 把现有 Vite 应用原样装进 Android WebView。
 * webDir 指向 dist，也就是 pnpm build 的产物 —— 与 Electron 用的是同一份前端。
 *
 * 关于权限：这个应用完全离线，不需要 INTERNET 也能跑。
 * 但 Capacitor 的 WebView 桥接默认会带上 INTERNET（用于本地 http 桥），
 * 我们在 AndroidManifest 里显式声明并注释说明它不用于上传账本。
 * 详见 docs/android-signing.md 与 README 的隐私章节。
 */

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: 'com.renqingledger.app',
  appName: '人情账',
  webDir: 'dist',

  // 只在 cap sync 时用得到；我们不用它的 server 模式
  bundledWebRuntime: false,

  android: {
    // 允许混合内容关闭 —— 应用不加载任何远程内容
    allowMixedContent: false,
    // 背景色与前端一致，避免启动白闪
    backgroundColor: '#f7f5f0',
    // 不用 http 方案，直接用 https://localhost 这类安全上下文
    // （WebCrypto 需要安全上下文，应用锁的加密依赖它）
    webContentsDebuggingEnabled: false,
  },

  server: {
    // 生产包不指定 server.url，走本地 file/https 加载
    androidScheme: 'https',
  },
};

export default config;
