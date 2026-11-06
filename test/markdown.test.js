import { describe, it, expect } from 'vitest';
import { buildMarkdown } from '../src/markdown.js';

const baseBook = (over = {}) => ({
  bookId: 'b1',
  title: '三体',
  author: '刘慈欣',
  cover: '',
  readingProgress: 1,
  markedStatus: null,
  noteCount: 1,
  reviewCount: 0,
  bookmarkCount: 0,
  highlights: [],
  thoughts: [],
  readingTimeSec: 45300,
  finishedDate: null,
  chapters: {},
  meta: {},
  errors: [],
  ...over,
});

const baseResult = (books) => ({
  exportedAt: 'x',
  userVid: '1',
  summary: {},
  shelf: { ok: true, books: [1, 2, 3] },
  books,
});

describe('buildMarkdown', () => {
  it('汇总行包含书数和书架数', () => {
    const md = buildMarkdown(baseResult([baseBook()]));
    expect(md).toContain('# 微信读书数据导出');
    expect(md).toContain('- 笔记书数: 1');
    expect(md).toContain('- 书架总数: 3');
    expect(md).toContain('## 《三体》  刘慈欣');
    expect(md).toContain('- 阅读时长: 12 小时 35 分钟');
  });

  it('划线按章节分组且多行 markText 每行都有引用符', () => {
    const b = baseBook({
      chapters: { c1: '第一章' },
      highlights: [
        { chapterUid: 'c1', markText: '第一行\n第二行' },
        { chapterUid: 'c1', markText: '另一条' },
      ],
    });
    const md = buildMarkdown(baseResult([b]));
    expect(md).toContain('**第一章**');
    expect(md).toContain('> 第一行\n> 第二行');
    expect(md).toContain('> 另一条');
  });

  it('想法(type=1)和书评(type=4)分节渲染', () => {
    const b = baseBook({
      thoughts: [
        { type: 1, content: '想法内容', createTime: 100 },
        { type: 4, content: '书评内容', createTime: 100 },
      ],
    });
    const md = buildMarkdown(baseResult([b]));
    expect(md).toContain('### 划线想法');
    expect(md).toContain('- 想法内容');
    expect(md).toContain('### 书评/想法');
    expect(md).toContain('书评内容');
  });

  it('无任何内容的书输出占位行', () => {
    const md = buildMarkdown(baseResult([baseBook()]));
    expect(md).toContain('*(本书暂无划线或想法)*');
  });

  it('errors 展示在书里', () => {
    const md = buildMarkdown(baseResult([baseBook({ errors: ['划线: HTTP 500'] })]));
    expect(md).toContain('⚠️ 部分数据抓取失败: 划线: HTTP 500');
  });
});
