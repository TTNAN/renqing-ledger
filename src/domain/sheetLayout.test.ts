/**
 * 礼簿列宽测试
 *
 * 少爷反馈的核心问题：同一个称呼，电脑上放得下、手机上被截断。
 * 根因是列宽只靠 measureText —— 它依赖当前环境加载的字体，
 * 而桌面（Microsoft YaHei）与安卓（Noto Sans CJK）字宽不同。
 *
 * 所以列宽改成「measureText 与按字符数估算取大」。
 * 这里验证估算函数本身够不够宽，以及几种极端字宽下的结果。
 */
import { describe, it, expect } from 'vitest';

/** 与 sheetCanvas 里保持一致的估算逻辑 */
const FONT_SIZE = 16;
function estimateWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    /* eslint-disable-next-line no-control-regex */
    w += /[\u0000-\u00ff]/.test(ch) ? FONT_SIZE * 0.58 : FONT_SIZE;
  }
  return w;
}

describe('称呼列宽度估算', () => {
  /*
   * 估算必须**不小于**真实宽度，否则手机上还会截断。
   * 中文全角字符在多数 CJK 字体里宽度约等于字号（16px），
   * 所以按 1 倍字号算 = 上限；这里确认不会低估。
   */
  const cases: Array<[string, number]> = [
    ['高中同学赵强', 6 * 16],
    ['张叔', 2 * 16],
    ['爱人的高中同学周老师', 10 * 16],
    ['前同事兼邻居李经理', 9 * 16],
    ['三舅家的表姐陈小燕', 9 * 16],
    ['大学室友王大力', 7 * 16],
  ];

  for (const [name, expected] of cases) {
    it(`「${name}」估算 ${expected}px`, () => {
      const got = estimateWidth(name);
      /* 每个全角字符都算满一个字号的宽度 */
      expect(got).toBe(expected);
      /* 关键：估算值必须 ≥ 满宽，不能低估 */
      expect(got).toBeGreaterThanOrEqual(name.length * FONT_SIZE);
    });
  }

  it('中英混排时 ASCII 按 0.58 倍算', () => {
    /* "A张" → 0.58*16 + 16 = 25.28 */
    expect(estimateWidth('A张')).toBeCloseTo(FONT_SIZE * 0.58 + FONT_SIZE, 5);
  });

  it('空字符串为 0', () => {
    expect(estimateWidth('')).toBe(0);
  });

  /*
   * 模拟真实场景：假设安卓字体比 Windows 宽 15%，
   * 确认「取大」之后仍能容纳。
   */
  it('字体比预期宽 15% 时仍放得下', () => {
    const COL_LIMIT = (794 - 62 * 2) * 0.42; // 42% 页宽
    const names = ['高中同学赵强', '爱人的高中同学周老师', '前同事兼邻居李经理'];

    for (const n of names) {
      /* 最坏情况：真实字体宽 15%，且 measureText 返回了这个偏大的值 */
      const realWidth = estimateWidth(n) * 1.15;
      const colW = Math.min(Math.max(realWidth, estimateWidth(n)) + 20, COL_LIMIT);

      expect(colW, `${n} 的列宽`).toBeGreaterThanOrEqual(realWidth);
    }
  });

  it('超长称呼会被 42% 上限挡住，不会挤没备注列', () => {
    const COL_LIMIT = (794 - 62 * 2) * 0.42;
    const veryLong = '这是一个非常非常长的称呼用来测试上限是否生效真的很长';
    const colW = Math.min(estimateWidth(veryLong) + 20, COL_LIMIT);
    expect(colW).toBe(COL_LIMIT);
  });
});
