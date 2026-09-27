/**
 * 人情账 · 礼簿渲染器（Canvas）
 *
 * 一份渲染逻辑，三端共用：
 *   - 手机端存 PDF / 存图片
 *   - 桌面端与网页端导出 PDF / 图片
 *
 * 设计取向：这是要打出来给长辈看的礼簿，不是屏幕 UI。
 *   - 米色纸底 + 深褐文字，像一本真的册子
 *   - 标题居中、双线分隔，下面一行小字记场次信息
 *   - 表格有表头底色、隔行浅纹、列对齐（金额右对齐、序号居中）
 *   - 页脚有页码与落款，多页时每页都带表头
 *
 * 尺寸按 A4 的 96dpi 像素（794×1123）画，导出时由 PDF 等比铺满，
 * 所以这里的边距都用「看起来舒服」的像素值，不用管 pt 换算。
 */

import type { LedgerSheet, LedgerSheetRow } from '@/domain/export';

/* ---------------------------------------------------------------- 版面常量 */

/** A4 @96dpi */
export const PAGE_W = 794;
export const PAGE_H = 1123;

/** 渲染倍率：2 倍即 1588×2246，打印足够清晰，体积也还能接受 */
const SCALE = 2;

const MARGIN_X = 62;
const MARGIN_TOP = 70;
const MARGIN_BOTTOM = 76;

/** 一行数据的高度 */
const ROW_H = 34;
/** 表头高度 */
const HEAD_H = 40;

/* 配色：米纸 + 褐墨，克制一点，像册子而不是网页 */
const C = {
  paper: '#fdfbf7',
  ink: '#33261c',
  inkSoft: '#6b5847',
  inkFaint: '#9c8873',
  rule: '#e4d8c6',
  ruleStrong: '#c9b79f',
  headBg: '#f2e9da',
  zebra: '#faf6ef',
  accent: '#8a5a2b',
};

const FONT =
  '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';

/* ---------------------------------------------------------------- 分页 */

/** 每页能放多少行（正文区高度 ÷ 行高） */
const BODY_TOP = MARGIN_TOP + 118; // 标题区占的高度
const BODY_BOTTOM = PAGE_H - MARGIN_BOTTOM - 54; // 留给合计与落款
export const ROWS_PER_PAGE = Math.floor((BODY_BOTTOM - BODY_TOP - HEAD_H) / ROW_H);

export interface SheetPage {
  rows: LedgerSheetRow[];
  pageNo: number;
  pageCount: number;
  /** 是否是最后一页（只有最后一页显示合计） */
  isLast: boolean;
}

/**
 * 把礼簿分页。
 *
 * 每页都带表头 —— 多页打出来散开了也能看懂每列是什么。
 * 合计只在最后一页显示，否则每页一个合计数会让人误读。
 */
export function paginateSheet(sheet: LedgerSheet): SheetPage[] {
  const rows = sheet.rows;
  if (rows.length === 0) {
    return [{ rows: [], pageNo: 1, pageCount: 1, isLast: true }];
  }

  const pages: SheetPage[] = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    pages.push({
      rows: rows.slice(i, i + ROWS_PER_PAGE),
      pageNo: pages.length + 1,
      pageCount: 0, // 下面回填
      isLast: false,
    });
  }
  pages.forEach((p, i) => {
    p.pageCount = pages.length;
    p.isLast = i === pages.length - 1;
  });
  return pages;
}

/* ---------------------------------------------------------------- 绘制 */

export interface RenderOptions {
  /** 表头里写的落款（谁记的账） */
  household: string;
  /** 总笔数与总金额，只画在最后一页 */
  totalText: string;
  totalCount: number;
}

/** 画一页到 canvas */
export function renderSheetPage(
  sheet: LedgerSheet,
  page: SheetPage,
  opts: RenderOptions,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W * SCALE;
  canvas.height = PAGE_H * SCALE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布上下文');
  ctx.scale(SCALE, SCALE);

  /* 纸底 */
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);

  let y = MARGIN_TOP;

  /* ---------------- 标题区 ---------------- */

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ink;
  ctx.font = `700 32px ${FONT}`;
  ctx.fillText(`${sheet.title} · 礼簿`, PAGE_W / 2, y + 24);

  /* 标题下的双线：上粗下细，古典册子的做法 */
  y += 40;
  ctx.strokeStyle = C.ruleStrong;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X + 90, y);
  ctx.lineTo(PAGE_W - MARGIN_X - 90, y);
  ctx.stroke();

  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X + 110, y + 3.5);
  ctx.lineTo(PAGE_W - MARGIN_X - 110, y + 3.5);
  ctx.stroke();

  /* 场次信息 */
  y += 26;
  ctx.fillStyle = C.inkSoft;
  ctx.font = `400 15px ${FONT}`;
  const sub = [sheet.type, sheet.dateText, sheet.location].filter(Boolean).join('　·　');
  ctx.fillText(sub, PAGE_W / 2, y);

  /* 多页时右上角标页码 */
  if (page.pageCount > 1) {
    ctx.textAlign = 'right';
    ctx.fillStyle = C.inkFaint;
    ctx.font = `400 13px ${FONT}`;
    ctx.fillText(`第 ${page.pageNo} / ${page.pageCount} 页`, PAGE_W - MARGIN_X, y - 26);
  }

  /* ---------------- 表格 ---------------- */

  y = BODY_TOP;

  const left = MARGIN_X;
  const right = PAGE_W - MARGIN_X;
  const contentW = right - left;

  /*
   * 列宽按内容算，而不是写死。
   *
   * 之前称呼列写死 96px —— 「高中同学赵强」6 个字放不下，
   * 被截成「高中同学…」。称呼是礼簿里最重要的信息，不能截。
   *
   * 现在的策略：
   *   1. 称呼列宽度取本页最长称呼的实际像素宽
   *   2. 金额列按「金额（元）」表头与最长金额取宽者
   *   3. 剩下的全给备注（备注截断可以接受，称呼不行）
   */
  const xIndex = left + 24;

  /*
   * 称呼字号。列宽估算与绘制都用它，提到这里统一维护。
   */
  const NAME_FONT_SIZE = 16;

  /*
   * 称呼列宽度。
   *
   * **不能只靠 measureText** —— 它依赖当前环境实际加载的字体，
   * 而桌面（Microsoft YaHei）与安卓（Noto Sans CJK）的字宽不同：
   * 在电脑上量出「高中同学赵强」= 96px、刚好放得下，
   * 换到手机同一串字更宽，就被截成「高中同学…」了。
   * 这正是「电脑端没问题、手机端还截断」的原因。
   *
   * 所以两边取大：
   *   1. measureText 的结果（当前环境准确值）
   *   2. 按字符数的保守估算（中文按 1 倍字号，ASCII 按 0.55 倍）
   * 后者与字体无关，给手机留出余量。
   */
  const nameColW = (() => {
    ctx.font = `600 ${NAME_FONT_SIZE}px ${FONT}`;

    /* 按字符数保守估宽，与字体无关 */
    const estimate = (s: string) => {
      let w = 0;
      for (const ch of s) {
        /* eslint-disable-next-line no-control-regex */
        w += /[\u0000-\u00ff]/.test(ch) ? NAME_FONT_SIZE * 0.58 : NAME_FONT_SIZE;
      }
      return w;
    };

    let w = ctx.measureText('称呼').width;
    for (const r of page.rows) {
      w = Math.max(w, ctx.measureText(r.name).width, estimate(r.name));
    }

    /*
     * 上限放宽到 42% 页宽。
     * 之前是 34%，对「爱人的高中同学周老师」这类 10 字称呼偏紧；
     * 备注列即使被压窄也仍能截断显示，不影响主信息。
     */
    return Math.min(w + 20, contentW * 0.42);
  })();

  const amountColW = (() => {
    /*
     * 金额列是数字（ASCII + 逗号 + 点），字宽差异比中文小得多，
     * 但同样按「测量与估算取大」处理，与称呼列保持一致的口径。
     * 表头「金额（元）」含全角括号，也要估够。
     */
    const estimateAscii = (s: string) => s.length * NAME_FONT_SIZE * 0.62;

    ctx.font = `600 15px ${FONT}`;
    let w = Math.max(ctx.measureText('金额（元）').width, 5 * NAME_FONT_SIZE);

    ctx.font = `600 16px ${FONT}`;
    for (const r of page.rows) {
      w = Math.max(w, ctx.measureText(r.amountText).width, estimateAscii(r.amountText));
    }
    return w + 20;
  })();

  const xName = xIndex + 26;
  const xAmount = right - 24;
  const xNote = xName + nameColW;
  /*
   * 备注列宽度：从它的起点到金额列左边界。
   * 备注超长可以截断（它本来就是补充信息），称呼不行。
   */
  const noteMaxW = Math.max(60, xAmount - amountColW - 16 - xNote);

  const drawHead = () => {
    /* 表头底色只铺到内容区，不顶到页面边 */
    ctx.fillStyle = C.headBg;
    ctx.fillRect(left, y, contentW, HEAD_H);

    /* 表头上下各一条线 */
    ctx.strokeStyle = C.ruleStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.moveTo(left, y + HEAD_H);
    ctx.lineTo(right, y + HEAD_H);
    ctx.stroke();

    /* 列间的竖线：让「序号／称呼／备注／金额」的边界一眼可见 */
    /*
     * 列间竖线。位置跟着动态列宽走 ——
     * 不能用魔法数字（之前 xAmount-108 就是写死的）。
     */
    const xDiv1 = xName - 14;
    const xDiv2 = xNote - 14;
    const xDiv3 = xAmount - amountColW;

    ctx.strokeStyle = C.rule;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(xDiv1, y);
    ctx.lineTo(xDiv1, y + HEAD_H);
    ctx.moveTo(xDiv2, y);
    ctx.lineTo(xDiv2, y + HEAD_H);
    ctx.moveTo(xDiv3, y);
    ctx.lineTo(xDiv3, y + HEAD_H);
    ctx.stroke();

    ctx.fillStyle = C.inkSoft;
    ctx.font = `600 15px ${FONT}`;
    ctx.textBaseline = 'middle';
    const cy = y + HEAD_H / 2;

    ctx.textAlign = 'center';
    ctx.fillText('序号', xIndex + 4, cy);
    ctx.textAlign = 'left';
    ctx.fillText('称呼', xName, cy);
    ctx.fillText('备注', xNote, cy);
    ctx.textAlign = 'right';
    ctx.fillText('金额（元）', xAmount, cy);
    ctx.textBaseline = 'alphabetic';

    y += HEAD_H;
  };

  drawHead();

  /* 数据行 */
  for (const row of page.rows) {
    /* 隔行浅纹，长表格更容易横向对齐着看 */
    if (row.index % 2 === 0) {
      ctx.fillStyle = C.zebra;
      ctx.fillRect(left, y, contentW, ROW_H);
    }

    const cy = y + ROW_H / 2;
    ctx.textBaseline = 'middle';

    /* 序号居中，与表头对齐 */
    ctx.fillStyle = C.inkFaint;
    ctx.font = `400 14px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(String(row.index), xIndex + 4, cy);

    ctx.fillStyle = C.ink;
    ctx.font = `600 16px ${FONT}`;
    ctx.textAlign = 'left';
    /*
     * 称呼直接画，不做截断。
     *
     * 列宽本来就是按「本页最长称呼」量出来的，所以一定放得下。
     * 之前这里又套了一层 fitText(nameColW - 18)，等于拿量出来的宽度
     * 再去判断一次是否超宽 —— 浮点比较的边界上，不同 WebView 的
     * measureText 精度略有差异，手机上就会误判成超宽而截断
     * （「高中同学赵强」→「高中同学…」正是这么来的）。
     *
     * 代价：极端长的称呼会稍微压到备注列，但备注本身可截断，
     * 而且列宽上限（34% 页宽）挡住了失控情况。
     */
    ctx.fillText(row.name, xName, cy);

    ctx.fillStyle = C.inkSoft;
    ctx.font = `400 14px ${FONT}`;
    ctx.fillText(fitText(ctx, row.note || '', noteMaxW), xNote, cy);

    ctx.fillStyle = C.ink;
    ctx.font = `600 16px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(row.amountText, xAmount, cy);

    /* 行分隔线：浅到几乎看不见，只起引导作用 */
    ctx.strokeStyle = C.rule;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(left, y + ROW_H);
    ctx.lineTo(right, y + ROW_H);
    ctx.stroke();

    ctx.textBaseline = 'alphabetic';
    y += ROW_H;
  }

  /* ---------------- 合计（仅最后一页） ---------------- */

  if (page.isLast && page.rows.length > 0) {
    y += 4;
    ctx.fillStyle = C.headBg;
    ctx.fillRect(left, y, contentW, HEAD_H);

    ctx.strokeStyle = C.ruleStrong;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.moveTo(left, y + HEAD_H);
    ctx.lineTo(right, y + HEAD_H);
    ctx.stroke();

    ctx.fillStyle = C.ink;
    ctx.font = `700 16px ${FONT}`;
    ctx.textBaseline = 'middle';
    const cy = y + HEAD_H / 2;

    ctx.textAlign = 'left';
    ctx.fillText(`共 ${opts.totalCount} 笔　合计`, xName, cy);
    ctx.textAlign = 'right';
    ctx.fillText(opts.totalText, xAmount, cy);
    ctx.textBaseline = 'alphabetic';

    y += HEAD_H;
  }

  /* ---------------- 页脚 ---------------- */

  const footY = PAGE_H - MARGIN_BOTTOM + 22;

  ctx.strokeStyle = C.rule;
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(MARGIN_X, footY - 20);
  ctx.lineTo(PAGE_W - MARGIN_X, footY - 20);
  ctx.stroke();

  ctx.fillStyle = C.inkFaint;
  ctx.font = `400 13px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText(`记账人：${opts.household}`, MARGIN_X, footY);

  ctx.textAlign = 'right';
  ctx.fillText('人情账 · 数据只保存在本机', PAGE_W - MARGIN_X, footY);

  return canvas;
}

/**
 * 按像素宽度截断文本。
 * 备注列最容易超宽，超了就省略，不硬挤下一列。
 */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!text) return '';
  if (maxWidth <= 0) return '';
  if (ctx.measureText(text).width <= maxWidth) return text;

  let out = text;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxWidth) {
    out = out.slice(0, -1);
  }
  return out + '…';
}

/* ---------------------------------------------------------------- 导出 */

/** canvas → JPEG 字节（给 PDF 用） */
export async function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality = 0.94,
): Promise<Uint8Array> {
  const blob = await toBlob(canvas, 'image/jpeg', quality);
  return new Uint8Array(await blob.arrayBuffer());
}

/** canvas → PNG 字节（给「存图片」用） */
export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await toBlob(canvas, 'image/png');
  return new Uint8Array(await blob.arrayBuffer());
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('画布导出失败'))),
      type,
      quality,
    );
  });
}
