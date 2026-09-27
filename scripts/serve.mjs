#!/usr/bin/env node
/**
 * 人情账 · 本地静态服务器
 *
 * 为什么需要它：构建产物是 ES Module，浏览器不允许从 file:// 直接加载模块。
 * 这个脚本用 Node 自带模块起一个只监听 127.0.0.1 的小服务器，
 * 不装任何依赖、不对外网开放，等价于「双击打开本地应用」。
 *
 *   pnpm build && pnpm start
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = fileURLToPath(new URL('../dist', import.meta.url));
const PORT = Number(process.env.PORT || 5273);
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel.endsWith('/')) rel += 'index.html';

    // 防目录穿越：规范化后必须仍在 dist 内
    const target = normalize(join(ROOT, rel));
    if (!target.startsWith(ROOT + sep) && target !== ROOT) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    let file = target;
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, 'index.html');
    } catch {
      // SPA 回退：未知路径一律交给 index.html
      file = join(ROOT, 'index.html');
    }

    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // 明确禁止任何外部资源：本地应用不需要联网能力
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end('读取文件失败：' + (err instanceof Error ? err.message : String(err)));
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log('');
  console.log('  人情账已在本机启动');
  console.log('  ' + url);
  console.log('');
  console.log('  数据只保存在这个浏览器里，不联网、不上传。按 Ctrl+C 退出。');
  console.log('');

  if (process.argv.includes('--open')) {
    const cmd =
      process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [url], { shell: true, stdio: 'ignore', detached: true }).unref();
  }
});
