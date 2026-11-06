import { CONFIG, ENDPOINTS } from './config.js';
import { apiGet, apiPost, withRetry } from './api.js';
import { collectPages } from './paginate.js';
import {
  mapBookmark,
  mapReview,
  mapShelfEntry,
  mapBookInfo,
  createBookRecord,
  extractUserVid,
} from './model.js';

export async function fetchNotebooks(log) {
  // 分页:count + lastSort 游标,hasMore 为 0 停止
  let total = '?';
  return collectPages(
    async (lastSort) => {
      const q = 'count=100' + (lastSort ? '&lastSort=' + encodeURIComponent(lastSort) : '');
      const data = await apiGet(ENDPOINTS.notebooks + '?' + q);
      const list = data.books || [];
      if (data.totalBookCount !== undefined) total = data.totalBookCount;
      return {
        items: list,
        nextCursor: list.length ? list[list.length - 1].sort : undefined,
        hasMore: Number(data.hasMore) === 1,
      };
    },
    { onPage: (_page, items) => log('书架扫描: ' + items.length + ' / ' + total) }
  );
}

export async function fetchBookHighlights(bookId, expectedCount, log) {
  const { tries, backoffMs } = CONFIG.bookmarkRetry;
  const arr = await withRetry(
    async () => {
      const data = await apiGet(ENDPOINTS.bookmarkList + '?bookId=' + bookId);
      return (data.updated || []).filter((b) => b && b.markText);
    },
    {
      tries,
      backoffMs,
      // 空结果但预期有划线 → 重试;拿到任何结果或本来就没预期 → 结束
      isResultOk: (list) => list.length > 0 || !expectedCount,
      onRetry: (err, attempt) => {
        if (!log) return;
        const waitSec = backoffMs[Math.min(attempt, backoffMs.length - 1)] / 1000;
        log(
          err
            ? `  ⚠️ bookmarklist 请求失败: ${err.message},重试...`
            : `  ⚠️ bookmarklist 空(期望${expectedCount}条),${waitSec}s后重试(${attempt + 2}/${tries})`
        );
      },
    }
  );
  return (arr || []).map(mapBookmark);
}

export async function fetchBookReviews(bookId) {
  // 想法/书评:type=1 划线想法, type=4 章节/全书书评
  const items = await collectPages(
    async (syncKey) => {
      const data = await apiGet(
        ENDPOINTS.reviewList +
          '?bookId=' + bookId +
          '&listType=11&mine=1&syncKey=' + (syncKey || 0) +
          '&count=100'
      );
      const next = data.syncKey !== undefined ? data.syncKey : data.synckey;
      return { items: data.reviews || [], nextCursor: next };
    },
    { maxPages: 100 }
  );
  const out = [];
  for (const r of items) {
    if (r && r.review) out.push(mapReview(r.review));
  }
  return out;
}

export async function fetchChapterTitles(bookId) {
  const data = await apiPost(ENDPOINTS.chapterInfos, {
    bookIds: [bookId],
    synckeys: [0],
    teenmode: 0,
  });
  const map = {};
  const upd = (data.data && data.data[0] && data.data[0].updated) || [];
  for (const c of upd) if (c && c.chapterUid) map[c.chapterUid] = c.title || '';
  return map;
}

export async function fetchReadInfo(bookId) {
  const data = await apiGet(
    ENDPOINTS.readInfo + '?bookId=' + bookId + '&readingDetail=1&readingBookIndex=1&finishedDate=1'
  );
  return {
    readingTime: data.readingTime || 0,
    readingProgress: data.readingProgress !== undefined ? data.readingProgress : null,
    markedStatus: data.markedStatus !== undefined ? data.markedStatus : null,
    finishedDate: data.finishedDate || null,
  };
}

export async function fetchBookInfo(bookId) {
  try {
    return mapBookInfo(await apiGet(ENDPOINTS.bookInfo + '?bookId=' + bookId));
  } catch (e) {
    return { title: '', author: '', isbn: '', category: '', intro: '', totalWords: 0, newRating: null };
  }
}

async function resolveUserVid(booksData) {
  // 优先取 cookie,其次 login/getinfo,最后从 reviewId 前缀提取
  const m = document.cookie.match(/(?:^|; )wr_vid=([^;]+)/);
  if (m) return m[1];
  try {
    const g = await apiGet(ENDPOINTS.loginInfo);
    if (g.userVid || g.vid || g.suid) return g.userVid || g.vid || g.suid;
  } catch (e) { /* ignore */ }
  return extractUserVid(booksData);
}

export async function fetchShelf(log, booksData) {
  const vid = await resolveUserVid(booksData);
  if (!vid) return { ok: false, reason: '无法获取 userVid(cookie wr_vid 缺失),书架跳过' };
  try {
    const data = await apiGet(
      ENDPOINTS.shelfSync + '?userVid=' + encodeURIComponent(vid) + '&synckey=0&lectureSynckey=0'
    );
    const shelf = (data.shelf && data.shelf.booksAndArchives) || data.books || [];
    const books = shelf.filter((s) => s && (s.book || s.bookId)).map(mapShelfEntry);
    return { ok: true, books, userVid: vid };
  } catch (e) {
    return { ok: false, reason: '书架抓取失败: ' + e.message };
  }
}

// 并发池
export async function mapLimit(items, limit, worker, log) {
  const results = new Array(items.length);
  let idx = 0;
  let done = 0;
  const runners = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) {
    runners.push(
      (async () => {
        while (idx < items.length) {
          const cur = idx++;
          results[cur] = await worker(items[cur]);
          done++;
          log('进度: ' + done + ' / ' + items.length + ' ' + (results[cur].title || items[cur].bookId));
        }
      })()
    );
  }
  await Promise.all(runners);
  return results;
}

// 单本全量抓取;局部失败记入 errors,不中断整本
export async function fetchBookComplete(entry, log) {
  const bookId = entry.bookId;
  const out = createBookRecord(entry);

  const collect = async (label, fn, apply) => {
    try {
      const v = await fn();
      if (apply) apply(v);
    } catch (e) {
      out.errors.push(label + ': ' + e.message);
    }
  };

  await collect('划线', () => fetchBookHighlights(bookId, out.noteCount, log), (v) => (out.highlights = v));
  await collect('想法', () => fetchBookReviews(bookId), (v) => (out.thoughts = v));
  try {
    out.chapters = await fetchChapterTitles(bookId);
  } catch (e) { /* 章节映射失败不致命 */ }
  await collect('阅读信息', () => fetchReadInfo(bookId), (ri) => {
    out.readingTimeSec = ri.readingTime;
    if (ri.readingProgress !== null) out.readingProgress = ri.readingProgress;
    out.markedStatus = ri.markedStatus;
    out.finishedDate = ri.finishedDate;
  });

  const meta = await fetchBookInfo(bookId);
  out.meta = meta;
  if (meta.title) out.title = meta.title;
  if (meta.author) out.author = meta.author;

  return out;
}
