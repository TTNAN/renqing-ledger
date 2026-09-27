/**
 * 人情账 · 生成网页图标（favicon）
 *
 *   node scripts/make-favicon.mjs
 *
 * 产出：
 *   public/favicon.ico          浏览器标签页（16/32/48）
 *   public/favicon-32.png       现代浏览器
 *   public/apple-touch-icon.png 存到手机桌面时用（180×180）
 *
 * 为什么单独一个脚本：
 *   favicon 是**网页**用的，跟桌面/安卓那两套（build/、android-res/）来源不同。
 *   这里统一用 app_icon（主体大，16×16 下也认得出），
 *   桌面图标那种留白多的写实风在小尺寸下会糊成一团。
 *
 * public/ 是 Vite 的约定目录：里面的文件会原样复制到 dist/，
 * 所以单文件版和网页版都能拿到。
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'assets', 'icons', 'source');
const OUT = join(ROOT, 'public');

if (!existsSync(SRC)) {
  console.error('找不到图标素材：' + SRC);
  process.exit(1);
}

/* ---------------------------------------------------------------- PNG 工具 */

function crc32(buf) {
  const table =
    crc32.table ||
    (crc32.table = (() => {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
      }
      return t;
    })());
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function decodePNG(buf) {
  let pos = 8;
  let w = 0;
  let h = 0;
  let ct = 6;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const t = buf.toString('ascii', pos + 4, pos + 8);
    const d = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (t === 'IHDR') {
      w = d.readUInt32BE(0);
      h = d.readUInt32BE(4);
      ct = d[9];
    } else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
  }
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);

  for (let y = 0; y < h; y += 1) {
    const f = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = cur[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x += 1) {
      const s = x * ch;
      const d = (y * w + x) * 4;
      if (ch === 1) {
        out[d] = out[d + 1] = out[d + 2] = cur[s];
        out[d + 3] = 255;
      } else if (ch === 2) {
        out[d] = out[d + 1] = out[d + 2] = cur[s];
        out[d + 3] = cur[s + 1];
      } else if (ch === 3) {
        out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2];
        out[d + 3] = 255;
      } else {
        out[d] = cur[s]; out[d + 1] = cur[s + 1];
        out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3];
      }
    }
    cur.copy(prev);
  }
  return { w, h, rgba: out };
}

function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y += 1) {
    const sy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < dw; x += 1) {
      const sx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      const d = (y * dw + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const p00 = src[(y0 * sw + x0) * 4 + c];
        const p10 = src[(y0 * sw + x1) * 4 + c];
        const p01 = src[(y1 * sw + x0) * 4 + c];
        const p11 = src[(y1 * sw + x1) * 4 + c];
        const top = p00 + (p10 - p00) * fx;
        const bot = p01 + (p11 - p01) * fx;
        out[d + c] = Math.round(top + (bot - top) * fy);
      }
    }
  }
  return out;
}

function encodeICO(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dirs = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const d = Buffer.alloc(16);
    d[0] = size >= 256 ? 0 : size;
    d[1] = size >= 256 ? 0 : size;
    d.writeUInt16LE(1, 4);
    d.writeUInt16LE(32, 6);
    d.writeUInt32LE(png.length, 8);
    d.writeUInt32LE(offset, 12);
    dirs.push(d);
    offset += png.length;
  }
  return Buffer.concat([header, ...dirs, ...images.map((i) => i.png)]);
}

/* ---------------------------------------------------------------- 生成 */

console.log('\n生成 favicon…\n');

mkdirSync(OUT, { recursive: true });

function loadIcon(size) {
  const p = join(SRC, `app_icon_${size}.png`);
  if (!existsSync(p)) throw new Error('缺少素材：' + p);
  return decodePNG(readFileSync(p));
}

function scaled(target) {
  const srcSize = target <= 64 ? 64 : target <= 128 ? 128 : target <= 256 ? 256 : 512;
  const s = loadIcon(srcSize);
  return s.w === target ? s.rgba : resize(s.rgba, s.w, s.h, target, target);
}

function save(rel, buf) {
  const full = join(OUT, rel);
  writeFileSync(full, buf);
  console.log(`  public/${rel.padEnd(24)} ${(buf.length / 1024).toFixed(1)} KB`);
}

/* 浏览器标签页 */
save(
  'favicon.ico',
  encodeICO([16, 32, 48].map((size) => ({ size, png: encodePNG(size, size, scaled(size)) }))),
);
save('favicon-32.png', encodePNG(32, 32, scaled(32)));
save('favicon-16.png', encodePNG(16, 16, scaled(16)));

/* 存到手机桌面 / iOS 主屏 */
save('apple-touch-icon.png', encodePNG(180, 180, scaled(180)));

/* 安卓/PWA 用的大图（可选，浏览器「添加到主屏幕」时会用） */
save('icon-192.png', encodePNG(192, 192, scaled(192)));
save('icon-512.png', encodePNG(512, 512, scaled(512)));

console.log('\n完成。public/ 里的文件会被 Vite 原样复制到 dist/。\n');
