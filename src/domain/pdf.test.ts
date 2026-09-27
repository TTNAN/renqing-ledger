/**
 * PDF 生成器测试
 *
 * 为什么必须测：PDF 结构错一个字节，阅读器就整个打不开。
 * 而且生成器是手写的（为了不引 jsPDF 那 300 KB 依赖），
 * 不测等于没做。
 *
 * 重点验 xref 偏移量 —— 每个对象在文件中的字节位置必须精确，
 * 这是手写 PDF 最容易写错、也最难肉眼发现的地方。
 * 多页时对象编号是算出来的，更容易错位，所以多页要单独验。
 */
import { describe, it, expect } from 'vitest';
import { imagesToPdf, jpegToPdf, A4_WIDTH, A4_HEIGHT } from './pdf';

/** 最小合法 JPEG（1×1） */
const TINY_JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00,
  ...Array(64).fill(0x08),
  0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xc4, 0x00, 0x1f, 0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04,
  0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
  0xff, 0xc4, 0x00, 0xb5, 0x10, 0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03,
  0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7d, 0x01, 0x02, 0x03, 0x00, 0x04,
  0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71,
  0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1,
  0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a,
  0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a,
  0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57,
  0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74,
  0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4,
  0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8,
  0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3,
  0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6,
  0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9,
  0xfa,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xfb, 0xd0, 0xff, 0xd9,
]);

const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

/** 校验 xref 表里每个偏移量都精确指向 "N 0 obj" */
function checkXref(text: string, expectedObjs: number): string | null {
  const m = text.match(/xref\n0 (\d+)\n([\s\S]*?)trailer/);
  if (!m) return '未找到 xref 段';

  const declared = parseInt(m[1]!, 10);
  if (declared !== expectedObjs + 1) {
    return `xref 声明 ${declared} 项，应为 ${expectedObjs + 1}`;
  }

  const lines = m[2]!.trim().split('\n');
  /* 第 0 项是 free 项，跳过 */
  for (let i = 1; i < lines.length; i += 1) {
    const off = parseInt(lines[i]!.slice(0, 10), 10);
    if (Number.isNaN(off)) return `第 ${i} 项偏移不是数字：${lines[i]}`;

    const marker = `${i} 0 obj`;
    const actual = text.slice(off, off + marker.length);
    if (actual !== marker) {
      return `对象 ${i}：偏移 ${off} 处是 "${actual}"，应为 "${marker}"`;
    }
  }
  return null;
}

describe('PDF 生成器', () => {
  describe('单页', () => {
    const pdf = jpegToPdf(TINY_JPEG, 1, 1, { title: '人情账 礼簿' });
    const text = latin1(pdf);

    it('骨架合法', () => {
      expect(text.startsWith('%PDF-')).toBe(true);
      expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(text).toContain('/Type /Catalog');
      expect(text).toContain('/Type /Pages');
      expect(text).toContain('/Type /Page');
      expect(text).toContain('/Root 1 0 R');
    });

    it('用 DCTDecode 直嵌 JPEG，不重新编码', () => {
      expect(text).toContain('/Filter /DCTDecode');
      expect(text).toContain('/Subtype /Image');
      expect(text).toContain('/Width 1 /Height 1');
    });

    it('内嵌的 JPEG 原始字节完整', () => {
      const idx = text.indexOf('\xff\xd8\xff\xdb');
      expect(idx).toBeGreaterThan(0);
      const embedded = pdf.slice(idx, idx + TINY_JPEG.length);
      expect(Array.from(embedded)).toEqual(Array.from(TINY_JPEG));
    });

    it('页面是 A4', () => {
      expect(text).toContain(`/MediaBox [0 0 ${A4_WIDTH.toFixed(2)} ${A4_HEIGHT.toFixed(2)}]`);
    });

    it('xref 偏移量精确指向每个对象', () => {
      /* 单页共 6 个对象：Catalog / Pages / Info / Page / Contents / Image */
      expect(checkXref(text, 6)).toBeNull();
    });

    it('startxref 指向 xref 表实际位置', () => {
      const m = text.match(/startxref\n(\d+)\n%%EOF/);
      expect(m).not.toBeNull();
      const pos = parseInt(m![1]!, 10);
      expect(text.slice(pos, pos + 4)).toBe('xref');
    });

    it('内容流把图铺满页面', () => {
      expect(text).toMatch(/q\n[\d.]+ 0 0 [\d.]+ [\d.]+ [\d.]+ cm\n\/Im0 Do\nQ/);
    });

    it('标题里的括号与反斜杠被转义', () => {
      const risky = jpegToPdf(TINY_JPEG, 1, 1, { title: 'test (a) \\ b' });
      const t = latin1(risky);
      const titleLine = t.match(/\/Title \(([^)]*)\)/);
      expect(titleLine).not.toBeNull();
      expect(titleLine![1]).not.toContain('(');
      expect(titleLine![1]).not.toContain('\\');
    });

    it('空标题也能生成', () => {
      const p = jpegToPdf(TINY_JPEG, 1, 1);
      expect(latin1(p).startsWith('%PDF-')).toBe(true);
    });
  });

  describe('多页', () => {
    const img = { data: TINY_JPEG, width: 1, height: 1 };

    it('两页：Kids 有两个，Count 为 2', () => {
      const pdf = imagesToPdf([img, img], { title: '多页' });
      const text = latin1(pdf);

      expect(text).toContain('/Count 2');

      /* Kids 里应有两个页面对象引用，形如 "4 0 R 7 0 R" */
      const kids = text.match(/\/Kids \[([^\]]+)\]/);
      expect(kids).not.toBeNull();
      const refs = kids![1]!.match(/\d+ 0 R/g) ?? [];
      expect(refs).toEqual(['4 0 R', '7 0 R']);

      /* 两页 → 2 个 /Type /Page（不含 /Pages） */
      const pageTypes = text.match(/\/Type \/Page[^s]/g) ?? [];
      expect(pageTypes.length).toBe(2);
    });

    it('两页：xref 覆盖全部 9 个对象', () => {
      const pdf = imagesToPdf([img, img]);
      const text = latin1(pdf);
      /* 1 Catalog + 1 Pages + 1 Info + 2×3 = 9 */
      expect(checkXref(text, 9)).toBeNull();
    });

    it('五页：对象编号不错位', () => {
      const pdf = imagesToPdf([img, img, img, img, img]);
      const text = latin1(pdf);
      /* 3 + 5×3 = 18 */
      expect(checkXref(text, 18)).toBeNull();
      expect(text).toContain('/Count 5');
    });

    it('每页都有自己的 Image 对象与尺寸', () => {
      /* 用不同尺寸的图，确认每页参数独立 */
      const a = { data: TINY_JPEG, width: 100, height: 200 };
      const b = { data: TINY_JPEG, width: 300, height: 400 };
      const text = latin1(imagesToPdf([a, b]));

      expect(text).toContain('/Width 100 /Height 200');
      expect(text).toContain('/Width 300 /Height 400');
    });

    it('每页的 Contents 引用各自的对象', () => {
      const pdf = imagesToPdf([img, img]);
      const text = latin1(pdf);
      /* 第 0 页：Page=4, Contents=5, Image=6；第 1 页：Page=7, Contents=8, Image=9 */
      expect(text).toContain('/Contents 5 0 R');
      expect(text).toContain('/Contents 8 0 R');
      expect(text).toMatch(/\/XObject << \/Im0 6 0 R >>/);
      expect(text).toMatch(/\/XObject << \/Im0 9 0 R >>/);
    });

    it('两页的 JPEG 字节都在文件里', () => {
      const pdf = imagesToPdf([img, img]);
      const text = latin1(pdf);
      const first = text.indexOf('\xff\xd8\xff\xdb');
      const second = text.indexOf('\xff\xd8\xff\xdb', first + 1);
      expect(first).toBeGreaterThan(0);
      expect(second).toBeGreaterThan(first);
    });

    it('空数组报错而不是产出坏文件', () => {
      expect(() => imagesToPdf([])).toThrow();
    });
  });
});
