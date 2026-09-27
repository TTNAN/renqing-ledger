/**
 * 单文件构建配置
 *
 * 目的：产出一个可以直接双击打开的 HTML。
 *
 * 为什么需要单独一份配置：
 *   常规构建用的是 ES Module（<script type="module">），
 *   而浏览器规定 file:// 页面（origin 为 null）不能用 CORS 拉取外部模块，
 *   所以双击 dist/index.html 必然是白屏。
 *
 *   这里做三件事绕开它：
 *     1. format: 'iife' —— 输出经典脚本，不含模块语义
 *     2. 资源全部内联（assetsInlineLimit 拉满 + cssCodeSplit 关闭）
 *     3. 构建后由 scripts/build-single.mjs 把 js/css 塞进 HTML 里
 *
 *   内联脚本不产生任何网络请求，file:// 下可以正常执行；
 *   而 IndexedDB 与 WebCrypto 在 file:// 下经实测均可用且可持久化。
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-single',
    emptyOutDir: true,
    // 关掉代码分割，产出单个 js
    cssCodeSplit: false,
    // 任何资源都内联成 base64，保证最终只有一个文件
    assetsInlineLimit: 100 * 1024 * 1024,
    target: 'es2019',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
