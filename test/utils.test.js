import { describe, it, expect } from 'vitest';
import { fmtDuration, fmtDate, nowStamp } from '../src/utils.js';
import { mdQuote } from '../src/markdown.js';

describe('fmtDuration', () => {
  it('空值返回 0 分钟', () => {
    expect(fmtDuration(0)).toBe('0 分钟');
    expect(fmtDuration(null)).toBe('0 分钟');
  });
  it('不足一小时只显示分钟', () => {
    expect(fmtDuration(600)).toBe('10 分钟');
  });
  it('超过一小时显示小时+分钟', () => {
    expect(fmtDuration(45300)).toBe('12 小时 35 分钟');
  });
});

describe('fmtDate', () => {
  it('使用本地时区而非 UTC', () => {
    // 2026-01-05 00:30 本地时间(UTC+8)对应 UTC 2026-01-04 16:30;
    // toISOString 会给出 2026-01-04,本地时区应为 2026-01-05
    const ts = new Date(2026, 0, 5, 0, 30).getTime() / 1000;
    expect(fmtDate(ts)).toBe('2026-01-05');
  });
  it('空值返回空串', () => {
    expect(fmtDate(0)).toBe('');
    expect(fmtDate(null)).toBe('');
  });
});

describe('nowStamp', () => {
  it('输出 YYYYMMDD_HHMM', () => {
    expect(nowStamp()).toMatch(/^\d{8}_\d{4}$/);
  });
});

describe('mdQuote', () => {
  it('单行加引用符', () => {
    expect(mdQuote('abc')).toBe('> abc');
  });
  it('多行每行都加引用符', () => {
    expect(mdQuote('a\nb\nc')).toBe('> a\n> b\n> c');
  });
  it('空值安全', () => {
    expect(mdQuote(null)).toBe('> ');
    expect(mdQuote('')).toBe('> ');
  });
});
