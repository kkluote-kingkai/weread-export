import { CONFIG } from './config.js';
import { sleep, download, nowStamp } from './utils.js';
import {
  fetchNotebooks,
  fetchBookComplete,
  fetchShelf,
  mapLimit,
} from './fetchers.js';
import { buildMarkdown } from './markdown.js';

// ---- 自动续跑:跳转到阅读页前存待办,页面加载后检测继续 ----
export function savePendingExport(all) {
  sessionStorage.setItem(CONFIG.pendingKey, JSON.stringify({ all, ts: Date.now() }));
}

export function takePendingExport() {
  const raw = sessionStorage.getItem(CONFIG.pendingKey);
  if (!raw) return null;
  sessionStorage.removeItem(CONFIG.pendingKey);
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

const onReaderPage = () => location.pathname.startsWith(CONFIG.readerPathPrefix);

export async function runExport(opts) {
  const { all, log } = opts;
  log('开始导出...');

  // 1. 阅读页上下文:bookmarklist 仅在有阅读会话时返回数据
  if (!onReaderPage()) {
    log('当前不在阅读页,bookmarklist 需要阅读会话。自动跳转到一本书,到达后会自动继续...');
    try {
      const probe = await fetchNotebooks(log);
      if (probe.length === 0) throw new Error('没有找到任何有笔记的书');
      savePendingExport(all);
      location.href = 'https://weread.qq.com/web/reader/' + encodeURIComponent(probe[0].bookId);
      return;
    } catch (e) {
      throw new Error('跳转阅读页失败: ' + e.message);
    }
  }

  // 2. 笔记本列表
  let books;
  try {
    log('读取笔记本列表...');
    books = await fetchNotebooks(log);
  } catch (e) {
    if (e.message.indexOf('HTTP 401') >= 0 || e.message.indexOf('AUTH') >= 0 || e.message.indexOf('登录') >= 0) {
      throw new Error('登录已失效,请先在 weread.qq.com 完成登录后重试');
    }
    throw e;
  }
  if (books.length === 0) {
    throw new Error('没有找到任何有笔记的书。若确实有,请先打开 weread.qq.com 完成登录,再点导出。');
  }
  log('共 ' + books.length + ' 本书含笔记,开始抓取细节...');

  // 3. 全量/增量过滤
  let targets = books;
  if (!all) {
    targets = books.filter(
      (b) => (b.noteCount || 0) > 0 || (b.reviewCount || 0) > 0 || (b.bookmarkCount || 0) > 0
    );
    log('增量模式: ' + targets.length + ' 本有划线的书');
  }

  // 4. 并发抓取每本书
  const details = await mapLimit(targets, CONFIG.concurrency, (entry) => fetchBookComplete(entry, log), log);

  // 5. 书架(尽力而为;此时已拿到想法,可从中提取 userVid)
  let shelf = null;
  try {
    shelf = await fetchShelf(log, details);
    if (shelf.ok) log('书架: ' + shelf.books.length + ' 本');
    else log(shelf.reason);
  } catch (e) {
    log('书架跳过: ' + e.message);
  }

  // 6. 汇总
  const result = {
    exportedAt: new Date().toISOString(),
    userVid: (shelf && shelf.userVid) || '',
    summary: {
      noteBooks: books.length,
      exportedBooks: details.length,
      highlights: details.reduce((a, b) => a + b.highlights.length, 0),
      thoughts: details.reduce((a, b) => a + b.thoughts.length, 0),
      readingSeconds: details.reduce((a, b) => a + b.readingTimeSec, 0),
    },
    shelf: shelf ? { ok: shelf.ok, books: shelf.ok ? shelf.books : [], reason: shelf.reason } : null,
    books: details,
  };

  // 7. 输出
  const stamp = nowStamp();
  download('weread_export_' + stamp + '.md', buildMarkdown(result));
  await sleep(1500);
  download('weread_export_' + stamp + '.json', JSON.stringify(result, null, 2), 'application/json');
}
