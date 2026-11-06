import { fmtDate, fmtDuration } from './utils.js';

// 多行文本逐行加引用符(单行 "> " 前缀只包住第一行的 bug 修复)
export const mdQuote = (text) =>
  String(text == null ? '' : text)
    .split('\n')
    .map((l) => '> ' + l)
    .join('\n');

function renderSummary(L, result) {
  L.push('# 微信读书数据导出');
  L.push('');
  L.push('- 导出时间: ' + new Date().toLocaleString());
  L.push('- 笔记书数: ' + result.books.length);
  L.push('- 划线总数: ' + result.books.reduce((a, b) => a + b.highlights.length, 0));
  L.push('- 想法总数: ' + result.books.reduce((a, b) => a + b.thoughts.length, 0));
  if (result.shelf && result.shelf.ok) {
    L.push('- 书架总数: ' + result.shelf.books.length);
  }
  L.push('');
  L.push('---');
  L.push('');
}

function renderBookMeta(L, b) {
  L.push('## 《' + b.title + '》' + (b.author ? '  ' + b.author : ''));
  L.push('');
  L.push('- 阅读进度: ' + (b.readingProgress !== null ? Math.round(b.readingProgress) + '%' : '未知'));
  L.push('- 阅读时长: ' + fmtDuration(b.readingTimeSec));
  if (b.finishedDate) L.push('- 读完日期: ' + fmtDate(b.finishedDate));
  if (b.meta.isbn) L.push('- ISBN: ' + b.meta.isbn);
  if (b.meta.category) L.push('- 分类: ' + b.meta.category);
  if (b.meta.totalWords) L.push('- 字数: ' + b.meta.totalWords);
  L.push('- 划线 ' + b.highlights.length + ' 条,想法 ' + b.thoughts.length + ' 条');
  if (b.errors.length) L.push('- ⚠️ 部分数据抓取失败: ' + b.errors.join('; '));
  L.push('');
}

function renderHighlights(L, b) {
  const groups = {};
  for (const h of b.highlights) {
    (groups[h.chapterUid] = groups[h.chapterUid] || []).push(h);
  }
  const keys = Object.keys(groups);
  if (!keys.length) return false;
  L.push('### 划线');
  L.push('');
  for (const k of keys) {
    L.push('**' + (b.chapters[k] || '未命名章节') + '**');
    L.push('');
    for (const h of groups[k]) {
      L.push(mdQuote(h.markText));
      L.push('');
    }
  }
  return true;
}

function renderThoughts(L, b) {
  const thoughts = b.thoughts.filter((t) => t.type === 1);
  const reviews = b.thoughts.filter((t) => t.type === 4);
  if (thoughts.length) {
    L.push('### 划线想法');
    L.push('');
    for (const t of thoughts) {
      L.push('- ' + t.content + (t.createTime ? '  (' + fmtDate(t.createTime) + ')' : ''));
    }
    L.push('');
  }
  if (reviews.length) {
    L.push('### 书评/想法');
    L.push('');
    for (const t of reviews) {
      L.push('**' + fmtDate(t.createTime) + '**');
      L.push('');
      L.push(t.content);
      L.push('');
    }
  }
  return thoughts.length + reviews.length;
}

export function buildMarkdown(result) {
  const L = [];
  renderSummary(L, result);
  for (const b of result.books) {
    renderBookMeta(L, b);
    const hasHighlights = renderHighlights(L, b);
    const thoughtCount = renderThoughts(L, b);
    if (!hasHighlights && !thoughtCount) {
      L.push('*(本书暂无划线或想法)*');
      L.push('');
    }
    L.push('---');
    L.push('');
  }
  return L.join('\n');
}
