/**
 * 金额工具 · 单测
 * 重点验证「整数分」与中文习惯输入。
 */

import { describe, expect, it } from 'vitest';
import {
  ceilToStep,
  centsToInput,
  floorToStep,
  formatCents,
  formatSignedCents,
  parseChineseNumber,
  parseMoneyToCents,
  roundToStep,
  yuanToCents,
} from './money';

describe('parseChineseNumber', () => {
  it('识别基本中文数字', () => {
    expect(parseChineseNumber('八百')).toBe(800);
    expect(parseChineseNumber('捌佰')).toBe(800);
    expect(parseChineseNumber('一千')).toBe(1000);
    expect(parseChineseNumber('两千五')).toBe(2500);
    expect(parseChineseNumber('十五')).toBe(15);
    expect(parseChineseNumber('三十五')).toBe(35);
    expect(parseChineseNumber('一万')).toBe(10000);
  });

  it('「零」不会被误当成口语简写', () => {
    expect(parseChineseNumber('一百零五')).toBe(105);
    expect(parseChineseNumber('一千零二十')).toBe(1020);
  });

  it('无法识别时返回 null', () => {
    expect(parseChineseNumber('abc')).toBeNull();
    expect(parseChineseNumber('')).toBeNull();
  });
});

describe('parseMoneyToCents', () => {
  it('纯数字', () => {
    expect(parseMoneyToCents('800')).toBe(80000);
    expect(parseMoneyToCents('1,200')).toBe(120000);
    expect(parseMoneyToCents('800.5')).toBe(80050);
    expect(parseMoneyToCents('800.55')).toBe(80055);
  });

  it('带「元」「块」「￥」', () => {
    expect(parseMoneyToCents('800元')).toBe(80000);
    expect(parseMoneyToCents('¥800')).toBe(80000);
    expect(parseMoneyToCents('￥1,000元')).toBe(100000);
  });

  it('中文数字', () => {
    expect(parseMoneyToCents('捌佰')).toBe(80000);
    expect(parseMoneyToCents('一千二')).toBe(120000);
    expect(parseMoneyToCents('两千五')).toBe(250000);
  });

  it('块 / 毛 / 分', () => {
    expect(parseMoneyToCents('三块五')).toBe(350);
    expect(parseMoneyToCents('3块5毛')).toBe(350);
    expect(parseMoneyToCents('3元2角')).toBe(320);
    expect(parseMoneyToCents('5块零5分')).toBe(505);
  });

  it('全角数字', () => {
    expect(parseMoneyToCents('８００')).toBe(80000);
  });

  it('混写', () => {
    expect(parseMoneyToCents('1万2')).toBe(1200000);
    expect(parseMoneyToCents('3千')).toBe(300000);
  });

  it('拒绝负数与空值', () => {
    expect(parseMoneyToCents('-100')).toBeNull();
    expect(parseMoneyToCents('')).toBeNull();
    expect(parseMoneyToCents('   ')).toBeNull();
    expect(parseMoneyToCents('随便写点什么')).toBeNull();
  });
});

describe('取整', () => {
  it('roundToStep 四舍五入到档位', () => {
    expect(roundToStep(83000, 10000)).toBe(80000);
    expect(roundToStep(85000, 10000)).toBe(90000);
    expect(roundToStep(83000, 5000)).toBe(85000);
  });

  it('floor / ceil', () => {
    expect(floorToStep(83900, 10000)).toBe(80000);
    expect(ceilToStep(83100, 10000)).toBe(90000);
  });

  it('step 为 0 时退化为普通取整，不炸', () => {
    expect(roundToStep(83100, 0)).toBe(83100);
  });
});

describe('换算与格式化', () => {
  it('yuanToCents 四舍五入到分', () => {
    expect(yuanToCents(800)).toBe(80000);
    expect(yuanToCents(8.005)).toBe(801);
    expect(yuanToCents(0.1 + 0.2)).toBe(30); // 浮点陷阱：0.30000000000000004
  });

  it('formatCents', () => {
    expect(formatCents(80000)).toBe('¥800');
    expect(formatCents(120000)).toBe('¥1,200');
    expect(formatCents(80050)).toBe('¥800.50');
    expect(formatCents(0)).toBe('¥0');
    expect(formatCents(80000, { symbol: false })).toBe('800');
    expect(formatCents(-60000)).toBe('-¥600');
  });

  it('formatSignedCents', () => {
    expect(formatSignedCents(60000)).toBe('+¥600');
    expect(formatSignedCents(-60000)).toBe('-¥600');
    expect(formatSignedCents(0)).toBe('¥0');
  });

  it('centsToInput 回填输入框', () => {
    expect(centsToInput(80000)).toBe('800');
    expect(centsToInput(80050)).toBe('800.50');
  });
});
