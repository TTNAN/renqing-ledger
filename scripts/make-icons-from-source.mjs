/**
 * 人情账 · 从正式图标素材生成各平台所需格式
 *
 *   pnpm icons:from-source
 *
 * 素材来自 icons_renqingzhang.zip，两套：
 *   app_icon_*.png      → iOS / Android（主体大、辨识度高）
 *   desktop_icon_*.png  → Windows .ico（写实风、留白多）
 *
 * 关键约束（少爷明确要求）：
 *   **源图是直角正方形，不要自己先做圆角。**
 *   已实测确认素材本身四角 alpha=255、满幅无圆角。
 *   所以这里只做「缩放 + 打包」，绝不添加圆角、阴影、边框或裁剪。
 *   圆角由各平台自己处理：
 *     - Android 自适应图标：系统按厂商形状裁切
 *     - iOS：系统自动加圆角遮罩
 *     - Windows：任务栏/开始菜单自己处理
 *
 * 产出：
 *   build/icon.ico                   Windows 安装包 + exe（多尺寸）
 *   build/icon.png                   Electron 通用（512）
 *   android-res/mipmap-xxx/          安卓各密度
 *     ic_launcher.png                  传统图标（系统可能自己加圆角）
 *     ic_launcher_round.png            圆形图标（系统会裁成圆）
 *     ic_launcher_foreground.png       自适应图标前景层
 *   android-res/values/ic_launcher_background.xml   自适应图标背景色
 *   android-res/drawable-xxx/splash.png             启动画面
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * 素材目录：assets/icons/source/
 *
 * 这里放的是设计给的原始导出（10 张 PNG，共约 2.6 MB），随仓库一起走 ——
 * 别人 clone 之后才能重新生成各平台图标，不用去要源文件。
 *
 * 如果只解压了 zip 还没整理，脚本会给出提示。
 */
const SRC = join(ROOT, 'assets', 'icons', 'source');
const LEGACY_SRC = join(ROOT, '.icons-extract', 'icons');

if (!existsSync(SRC)) {
  if (existsSync(LEGACY_SRC)) {
    console.error('\n图标素材不在预期位置。请整理一下：');
    console.error('  mkdir assets\\icons\\source');
    console.error('  copy .icons-extract\\icons\\* assets\\icons\\source\\\n');
  } else {
    console.error('\n找不到图标素材目录：' + SRC);
    console.error('请解压 icons_renqingzhang.zip 并把里面的 png 放到该目录：');
    console.error('  Expand-Archive icons_renqingzhang.zip -DestinationPath .icons-extract -Force');
    console.error('  mkdir assets\\icons\\source');
    console.error('  copy .icons-extract\\icons\\* assets\\icons\\source\\\n');
  }
  process.exit(1);
}

/* ================================================================== PNG 工具 */

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

/** RGBA → PNG Buffer */
function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // filter: None
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 解析 PNG（支持 8-bit RGB / RGBA / 灰度，非隔行）→ { w, h, rgba } */
function decodePNG(buf) {
  if (buf[0] !== 0x89 || buf[1] !== 0x50) throw new Error('不是 PNG');

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  const idat = [];

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('不支持隔行 PNG');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8) throw new Error('只支持 8-bit PNG，实际 ' + bitDepth);

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('不支持的颜色类型 ' + colorType);

  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 4);

  /* 反滤波 */
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    raw.copy(cur, 0, y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);

    for (let i = 0; i < stride; i += 1) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = v & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const s = x * bpp;
      const d = (y * width + x) * 4;
      if (channels === 1) {
        out[d] = out[d + 1] = out[d + 2] = cur[s];
        out[d + 3] = 255;
      } else if (channels === 2) {
        out[d] = out[d + 1] = out[d + 2] = cur[s];
        out[d + 3] = cur[s + 1];
      } else if (channels === 3) {
        out[d] = cur[s]; out[d + 1] = cur[s + 1]; out[d + 2] = cur[s + 2];
        out[d + 3] = 255;
      } else {
        out[d] = cur[s]; out[d + 1] = cur[s + 1];
        out[d + 2] = cur[s + 2]; out[d + 3] = cur[s + 3];
      }
    }

    cur.copy(prev);
  }

  return { w: width, h: height, rgba: out };
}

/**
 * 双线性缩放（保持直角，绝不加圆角）。
 * 缩放图片本身是纯数学操作，不会改变「方形直角」这个属性。
 */
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

/* ================================================================== ICO 封装 */

/** 多尺寸 ICO（内嵌 PNG，Vista+ 支持） */
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

/* ================================================================== 主流程 */

function save(rel, buf) {
  const full = join(ROOT, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, buf);
  console.log(`  ${rel.padEnd(52)} ${(buf.length / 1024).toFixed(1)} KB`);
}

function loadIcon(kind, size) {
  const p = join(SRC, `${kind}_icon_${size}.png`);
  if (!existsSync(p)) throw new Error('缺少素材：' + p);
  return decodePNG(readFileSync(p));
}

console.log('\n从正式素材生成各平台图标…\n');
console.log('  素材：assets/icons/source/（设计原始导出，随仓库一起走）');
console.log('  原则：只缩放与打包，不加圆角、不裁剪、不加阴影\n');

/* ---------- Windows：用 desktop_icon ---------- */

console.log('【Windows】用 desktop_icon（写实风，留白多）');

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const icoImages = [];

for (const size of ICO_SIZES) {
  /* 优先用最接近的原始素材，避免从 1024 反复缩放损失细节 */
  const srcSize = size <= 64 ? 64 : size <= 128 ? 128 : size <= 256 ? 256 : 512;
  const src = loadIcon('desktop', srcSize);
  const rgba = src.w === size ? src.rgba : resize(src.rgba, src.w, src.h, size, size);
  icoImages.push({ size, png: encodePNG(size, size, rgba) });
}

save('build/icon.ico', encodeICO(icoImages));
save('build/icon.png', (() => {
  const s = loadIcon('desktop', 512);
  return encodePNG(512, 512, s.rgba);
})());
save('build/icon-512.png', (() => {
  const s = loadIcon('desktop', 512);
  return encodePNG(512, 512, s.rgba);
})());

/* ---------- Android：用 app_icon ---------- */

console.log('\n【Android】用 app_icon（卡通风，主体大、小尺寸辨识度高）');

const ANDROID_DENSITIES = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
];

/** 从素材取图并缩放到目标尺寸 */
function scaled(kind, targetSize) {
  const srcSize = targetSize <= 64 ? 64 : targetSize <= 128 ? 128 : targetSize <= 256 ? 256 : 512;
  const s = loadIcon(kind, srcSize);
  return s.w === targetSize ? s.rgba : resize(s.rgba, s.w, s.h, targetSize, targetSize);
}

for (const [density, size] of ANDROID_DENSITIES) {
  /* 传统图标：直接用方图。系统会自己按厂商形状加圆角 */
  save(
    `android-res/mipmap-${density}/ic_launcher.png`,
    encodePNG(size, size, scaled('app', size)),
  );

  /* 圆形图标：同样给方图，系统会裁成圆。
     注意：这里刻意不自己画圆 —— 那会破坏「保持直角」的要求，
     而且系统裁切时会二次裁切导致边缘缺失。 */
  save(
    `android-res/mipmap-${density}/ic_launcher_round.png`,
    encodePNG(size, size, scaled('app', size)),
  );

  /*
   * 自适应图标前景层（Android 8+）。
   *
   * 系统会把前景层放在 108dp 的画布上，只保证中间 72dp 可见
   * （外侧各 18dp 可能被裁）。所以前景内容要缩到约 66%，
   * 四周留透明边距，否则图会被裁掉一圈。
   *
   * 背景层用纯色（见下面生成的 ic_launcher_background.xml），
   * 所以前景只放「礼盒+账本」本身，并保留其原本的方形直角。
   */
  const fgCanvas = Math.round(size * 1.5);        // 108dp 相对 72dp 的比例
  const fgContent = Math.round(fgCanvas * 0.66);  // 内容占 66%
  const fgOffset = Math.round((fgCanvas - fgContent) / 2);

  const content = scaled('app', fgContent);
  const fgPx = Buffer.alloc(fgCanvas * fgCanvas * 4); // 全透明底
  for (let y = 0; y < fgContent; y += 1) {
    for (let x = 0; x < fgContent; x += 1) {
      const si = (y * fgContent + x) * 4;
      const di = ((y + fgOffset) * fgCanvas + (x + fgOffset)) * 4;
      fgPx[di] = content[si];
      fgPx[di + 1] = content[si + 1];
      fgPx[di + 2] = content[si + 2];
      fgPx[di + 3] = content[si + 3];
    }
  }

  save(
    `android-res/mipmap-${density}/ic_launcher_foreground.png`,
    encodePNG(fgCanvas, fgCanvas, fgPx),
  );
}

/* 自适应图标的背景色：取素材四角的颜色（那就是背景色） */
const corner = loadIcon('app', 64);
const bgR = corner.rgba[0];
const bgG = corner.rgba[1];
const bgB = corner.rgba[2];
const bgHex = '#' + [bgR, bgG, bgB].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

mkdirSync(join(ROOT, 'android-res', 'values'), { recursive: true });
writeFileSync(
  join(ROOT, 'android-res', 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<!--
  自适应图标的背景层颜色。
  取自 app_icon 素材四角的颜色（${bgHex}），
  这样前景层缩放后，边缘与背景色自然衔接，看不出接缝。
-->
<resources>
    <color name="ic_launcher_background">${bgHex}</color>
</resources>
`,
  'utf8',
);
console.log(`  android-res/values/ic_launcher_background.xml              ${bgHex}`);

/* ---------- 启动画面 ---------- */

console.log('\n【启动画面】纸色底 + 居中图标');

function splash(w, h) {
  const px = Buffer.alloc(w * h * 4);
  /* 背景用素材四角色，与图标统一 */
  for (let i = 0; i < w * h; i += 1) {
    px[i * 4] = bgR;
    px[i * 4 + 1] = bgG;
    px[i * 4 + 2] = bgB;
    px[i * 4 + 3] = 255;
  }
  /* 居中放图标 */
  const size = Math.round(Math.min(w, h) * 0.28);
  const icon = scaled('app', size);
  const ox = Math.round((w - size) / 2);
  const oy = Math.round((h - size) / 2);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const si = (y * size + x) * 4;
      const di = ((y + oy) * w + (x + ox)) * 4;
      /* 图标是不透明的，直接覆盖 */
      px[di] = icon[si];
      px[di + 1] = icon[si + 1];
      px[di + 2] = icon[si + 2];
      px[di + 3] = 255;
    }
  }
  return px;
}

const SPLASHES = [
  ['drawable/splash.png', 480, 320],
  ['drawable-land-hdpi/splash.png', 800, 480],
  ['drawable-land-xhdpi/splash.png', 1280, 720],
  ['drawable-land-xxhdpi/splash.png', 1600, 960],
  ['drawable-land-xxxhdpi/splash.png', 1920, 1280],
  ['drawable-port-hdpi/splash.png', 480, 800],
  ['drawable-port-xhdpi/splash.png', 720, 1280],
  ['drawable-port-xxhdpi/splash.png', 960, 1600],
  ['drawable-port-xxxhdpi/splash.png', 1280, 1920],
];
for (const [rel, w, h] of SPLASHES) {
  save(`android-res/${rel}`, encodePNG(w, h, splash(w, h)));
}

/* ---------- 校验 ---------- */

console.log('\n【校验】确认产物边缘仍是直角、无圆角');

const checkIco = decodePNG(icoImages.find((i) => i.size === 256).png);
const corners = [
  checkIco.rgba[3],
  checkIco.rgba[(255) * 4 + 3],
  checkIco.rgba[(255 * 256) * 4 + 3],
  checkIco.rgba[(255 * 256 + 255) * 4 + 3],
];
console.log(`  build/icon.ico (256px) 四角 alpha: ${corners.join(', ')}`);
console.log(`  → ${corners.every((a) => a === 255) ? '✓ 直角满幅，未做圆角' : '★ 四角有透明，可能被加了圆角'}`);

const checkLauncher = decodePNG(
  readFileSync(join(ROOT, 'android-res/mipmap-xxxhdpi/ic_launcher.png')),
);
const lc = [
  checkLauncher.rgba[3],
  checkLauncher.rgba[(191) * 4 + 3],
  checkLauncher.rgba[(191 * 192) * 4 + 3],
  checkLauncher.rgba[(191 * 192 + 191) * 4 + 3],
];
console.log(`  ic_launcher.png (192px) 四角 alpha: ${lc.join(', ')}`);
console.log(`  → ${lc.every((a) => a === 255) ? '✓ 直角满幅，未做圆角' : '★ 四角有透明'}`);

const checkFg = decodePNG(
  readFileSync(join(ROOT, 'android-res/mipmap-xxxhdpi/ic_launcher_foreground.png')),
);
console.log(`  ic_launcher_foreground.png 尺寸 ${checkFg.w}×${checkFg.h}（108dp 画布，内容居中 66%）`);
console.log(`    四角 alpha: ${[0, 287, 287 * 288, 287 * 288 + 287].map((i) => checkFg.rgba[i * 4 + 3]).join(', ')}（应为 0，留白给系统裁切）`);

console.log('\n完成。');
console.log('  Windows : build/icon.ico（16/24/32/48/64/128/256，desktop_icon）');
console.log('  Android : android-res/（app_icon，5 种密度 × 3 个图标 + 9 张启动图）');
console.log('\n  下一步：pnpm build:all\n');
