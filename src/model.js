// API 原始字段 -> 导出结构的归一化

export const mapBookmark = (b) => ({
  chapterUid: b.chapterUid,
  markText: b.markText,
  color: b.color,
  createTime: b.createTime,
});

export const mapReview = (r) => ({
  type: r.type,
  content: r.content,
  chapterUid: r.chapterUid,
  createTime: r.createTime,
  reviewId: r.reviewId,
});

export const mapShelfEntry = (s) => ({
  bookId: s.book.bookId,
  title: s.book.title || '',
  author: s.book.author || '',
  cover: s.book.cover || '',
  format: s.book.format || '',
  readUpdateTime: s.readUpdateTime || 0,
});

export function createBookRecord(entry) {
  const base = entry.book || {};
  return {
    bookId: entry.bookId,
    title: base.title || entry.title || '',
    author: base.author || '',
    cover: base.cover || '',
    readingProgress: entry.readingProgress !== undefined ? entry.readingProgress : null,
    markedStatus: entry.markedStatus !== undefined ? entry.markedStatus : null,
    noteCount: entry.noteCount || 0,
    reviewCount: entry.reviewCount || 0,
    bookmarkCount: entry.bookmarkCount || 0,
    highlights: [],
    thoughts: [],
    readingTimeSec: 0,
    finishedDate: null,
    chapters: {},
    meta: {},
    errors: [],
  };
}

export function mapBookInfo(data) {
  return {
    title: data.title || '',
    author: data.author || '',
    isbn: data.isbn || '',
    category: (data.category && data.category.title) || data.category || '',
    intro: data.intro || '',
    totalWords: data.totalWords || 0,
    newRating: data.newRating !== undefined ? data.newRating : null,
  };
}

// reviewId 形如 "<vid>_xxxxx",可从想法里提取 userVid
export function extractUserVid(booksData) {
  for (const b of booksData || []) {
    for (const t of b.thoughts || []) {
      if (t.reviewId && String(t.reviewId).includes('_')) {
        return String(t.reviewId).split('_')[0];
      }
    }
  }
  return '';
}
