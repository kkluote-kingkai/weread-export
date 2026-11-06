import { describe, it, expect } from 'vitest';
import { mapBookmark, mapReview, createBookRecord, mapBookInfo, extractUserVid } from '../src/model.js';

describe('mapBookmark', () => {
  it('只保留需要的字段', () => {
    const b = mapBookmark({ chapterUid: 1, markText: 'hi', color: 2, createTime: 100, extra: 'x' });
    expect(b).toEqual({ chapterUid: 1, markText: 'hi', color: 2, createTime: 100 });
  });
});

describe('mapReview', () => {
  it('映射 review 内层字段', () => {
    expect(mapReview({ type: 1, content: 'c', chapterUid: 3, createTime: 9, reviewId: 'v_1' }))
      .toEqual({ type: 1, content: 'c', chapterUid: 3, createTime: 9, reviewId: 'v_1' });
  });
});

describe('createBookRecord', () => {
  it('从 notebook 条目初始化,缺省字段有默认值', () => {
    const r = createBookRecord({ bookId: 'b1', noteCount: 3 });
    expect(r.bookId).toBe('b1');
    expect(r.highlights).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.readingProgress).toBeNull();
  });
  it('title 优先取 entry.book.title', () => {
    const r = createBookRecord({ bookId: 'b1', title: 't1', book: { title: 't2' } });
    expect(r.title).toBe('t2');
  });
});

describe('mapBookInfo', () => {
  it('category 兼容对象和字符串', () => {
    expect(mapBookInfo({ category: { title: '科幻' } }).category).toBe('科幻');
    expect(mapBookInfo({ category: '科幻' }).category).toBe('科幻');
  });
});

describe('extractUserVid', () => {
  it('从 reviewId 前缀提取 vid', () => {
    const books = [{ thoughts: [{ reviewId: '12345_abc' }] }];
    expect(extractUserVid(books)).toBe('12345');
  });
  it('没有下划线 reviewId 时返回空', () => {
    expect(extractUserVid([{ thoughts: [{ reviewId: 'abc' }] }])).toBe('');
    expect(extractUserVid([])).toBe('');
  });
});
