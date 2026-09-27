/**
 * 人情账 · 极简 PDF 生成器（图片型，支持多页）
 *
 * 为什么是「图片型」而不是文本型：
 *   PDF 文本需要嵌入中文字库，一个字库 5-10 MB，
 *   会让本来就 4 MB 的 APK 翻好几倍。
 *   图片型只需把 Canvas 的 JPEG 塞进去，几十 KB 就够，
 *   中文由系统字体渲染，不依赖字库。
 *
 * 为什么不用 jsPDF：
 *   它压缩后约 300 KB，而我们只要「A4 + 几张图」，
 *   手写 PDF 结构一百多行就够。少一个依赖，少一份体积。
 *
 * 单页结构：
 *   Catalog → Pages → Page → Contents + Image → Info
 * 多页时：
 *   Catalog → Pages → [Page1, Page2, ...]
 *   每页各有自己的 Contents 与 Image 对象。
 */

/** PDF 坐标单位是「点」，A4 = 595.28 × 841.89 pt */
export const A4_WIDTH = 595.28;
export const A4_HEIGHT = 841.89;

/** 图片铺在页面上时四周留的白边（pt） */
const MARGIN = 20;

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const enc = new TextEncoder();
const bytes = (s: string) => enc.encode(s);

export interface PdfImage {
  /** JPEG 字节（canvas.toBlob('image/jpeg') 得来） */
  data: Uint8Array;
  /** 图片像素宽 */
  width: number;
  /** 图片像素高 */
  height: number;
}

/**
 * 把若干张图各铺成一页 A4，生成 PDF。
 *
 * @param images 每张图一页，顺序即页序
 * @param opts.title 写入 PDF 元数据，文件管理里能看到名字
 */
export function imagesToPdf(
  images: PdfImage[],
  opts: { title?: string } = {},
): Uint8Array {
  if (images.length === 0) throw new Error('至少需要一张图');

  /*
   * 对象编号：
   *   1 = Catalog
   *   2 = Pages
   *   3 = Info
   *   然后每页占 3 个对象（Page / Contents / Image）
   *   第 i 页（从 0 起）：page=4+i*3, contents=5+i*3, image=6+i*3
   */
  const pageObj = (i: number) => 4 + i * 3;
  const contentObj = (i: number) => 5 + i * 3;
  const imageObj = (i: number) => 6 + i * 3;

  const totalObjs = 3 + images.length * 3;

  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = 0;

  const push = (chunk: Uint8Array) => {
    parts.push(chunk);
    pos += chunk.length;
  };
  const pushStr = (s: string) => push(bytes(s));
  const startObj = (n: number) => {
    offsets[n] = pos;
    pushStr(`${n} 0 obj\n`);
  };

  /* ---- 头 ---- */
  pushStr('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  /* ---- 1: Catalog ---- */
  startObj(1);
  pushStr('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  /* ---- 2: Pages ---- */
  startObj(2);
  const kids = images.map((_, i) => `${pageObj(i)} 0 R`).join(' ');
  pushStr(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>\nendobj\n`);

  /* ---- 3: Info ---- */
  const title = (opts.title ?? '人情账 礼簿').replace(/[()\\]/g, ' ');
  startObj(3);
  pushStr(
    `<< /Title (${title}) /Producer (RenqingLedger) /Creator (RenqingLedger) >>\nendobj\n`,
  );

  /* ---- 每页 ---- */
  for (let i = 0; i < images.length; i += 1) {
    const img = images[i]!;

    /* 等比缩放并居中 */
    const maxW = A4_WIDTH - MARGIN * 2;
    const maxH = A4_HEIGHT - MARGIN * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const offsetX = (A4_WIDTH - drawW) / 2;
    /* PDF 原点在左下角，所以从上方算下来 */
    const offsetY = A4_HEIGHT - MARGIN - drawH;

    const content =
      `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ` +
      `${offsetX.toFixed(2)} ${offsetY.toFixed(2)} cm\n/Im0 Do\nQ\n`;

    /* Page */
    startObj(pageObj(i));
    pushStr(
      `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${A4_WIDTH.toFixed(2)} ${A4_HEIGHT.toFixed(2)}] ` +
        `/Resources << /XObject << /Im0 ${imageObj(i)} 0 R >> >> ` +
        `/Contents ${contentObj(i)} 0 R >>\nendobj\n`,
    );

    /* Contents */
    startObj(contentObj(i));
    pushStr(`<< /Length ${content.length} >>\nstream\n`);
    pushStr(content);
    pushStr('endstream\nendobj\n');

    /* Image：JPEG 用 DCTDecode 直嵌，PDF 原生支持，无需重新编码 */
    startObj(imageObj(i));
    pushStr(
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
        `/Length ${img.data.length} >>\nstream\n`,
    );
    push(img.data);
    pushStr('\nendstream\nendobj\n');
  }

  /* ---- xref ---- */
  const xrefPos = pos;
  const count = totalObjs + 1;
  pushStr(`xref\n0 ${count}\n`);
  pushStr('0000000000 65535 f \n');
  for (let n = 1; n <= totalObjs; n += 1) {
    pushStr(String(offsets[n] ?? 0).padStart(10, '0') + ' 00000 n \n');
  }

  /* ---- trailer ---- */
  pushStr(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\n`);
  pushStr(`startxref\n${xrefPos}\n%%EOF\n`);

  return concat(parts);
}

/** 单页的便捷封装（保持向后兼容） */
export function jpegToPdf(
  jpeg: Uint8Array,
  imgW: number,
  imgH: number,
  opts: { title?: string } = {},
): Uint8Array {
  return imagesToPdf([{ data: jpeg, width: imgW, height: imgH }], opts);
}
