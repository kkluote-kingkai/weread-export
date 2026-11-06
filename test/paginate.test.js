import { describe, it, expect, vi } from 'vitest';
import { collectPages } from '../src/paginate.js';

const page = (items, nextCursor, hasMore) => ({ items, nextCursor, hasMore });

describe('collectPages', () => {
  it('hasMore=false 停止', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page([1, 2], 'c1', true))
      .mockResolvedValueOnce(page([3], 'c2', false));
    const items = await collectPages(fetchPage);
    expect(items).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('空页停止', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page([1], 'c1', true))
      .mockResolvedValueOnce(page([], 'c2', true));
    const items = await collectPages(fetchPage);
    expect(items).toEqual([1]);
  });

  it('nextCursor 不变时停止(防死循环)', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page([1], 'same'))
      .mockResolvedValueOnce(page([2], 'same'));
    const items = await collectPages(fetchPage);
    expect(items).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('nextCursor 缺失时停止', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce(page([1], undefined));
    const items = await collectPages(fetchPage);
    expect(items).toEqual([1]);
  });

  it('maxPages 兜底', async () => {
    let i = 0;
    const fetchPage = vi.fn(() => Promise.resolve(page([i], 'c' + i++, true)));
    const items = await collectPages(fetchPage, { maxPages: 5 });
    expect(items).toHaveLength(5);
  });

  it('onPage 回调拿到累计列表', async () => {
    const seen = [];
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(page([1], 'c1', true))
      .mockResolvedValueOnce(page([2], 'c2', false));
    await collectPages(fetchPage, { onPage: (_p, items) => seen.push([...items]) });
    expect(seen).toEqual([[1], [1, 2]]);
  });
});
