/**
 * 临时验证：金额小数点的解析与显示
 */
import { describe, it, expect } from 'vitest';
import { formatCents, parseMoneyToCents, centsToInput } from './money';

describe('金额小数点', () => {
  const cases: Array<[string, number | null, string]> = [
    ['800', 80000, '¥800'],
    ['800.5', 80050, '¥800.50'],
    ['800.50', 80050, '¥800.50'],
    ['800.55', 80055, '¥800.55'],
    ['1200.05', 120005, '¥1,200.05'],
    ['0.5', 50, '¥0.50'],
    ['3.55', 355, '¥3.55'],
    ['1000.99', 100099, '¥1,000.99'],
    ['1,200.50', 120050, '¥1,200.50'],
    ['八百', 80000, '¥800'],
    ['三块五', 350, '¥3.50'],
    ['800.999', 80100, '¥801'],   // 超过两位小数：四舍五入到分再进位
    ['800.', 80000, '¥800'],
    ['800元', 80000, '¥800'],
  ];

  for (const [input, cents, display] of cases) {
    it(`"${input}" → ${cents} 分 → ${display}`, () => {
      const got = parseMoneyToCents(input);
      console.log(`    ${input.padEnd(12)} → ${String(got).padEnd(10)} → ${got === null ? '（认不出）' : formatCents(got)}`);
      expect(got).toBe(cents);
      if (got !== null) expect(formatCents(got)).toBe(display);
    });
  }

  it('回填到输入框时保留小数', () => {
    expect(centsToInput(80050)).toBe('800.50');
    expect(centsToInput(80000)).toBe('800');
    expect(centsToInput(50)).toBe('0.50');
  });
});
