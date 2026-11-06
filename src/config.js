export const CONFIG = {
  // 并发抓取的书本数
  concurrency: 4,
  // 全局请求最小间隔(ms)。原实现是每个 worker 睡 300ms、4 并发 ≈ 13 req/s;
  // 统一限速器后 80ms ≈ 12.5 req/s,速率相当但更平滑。
  minRequestIntervalMs: 80,
  // 分页循环安全上限
  maxPages: 500,
  // bookmarklist 偶发静默返回空(限速/临时失败),需要重试+退避
  bookmarkRetry: { tries: 4, backoffMs: [1500, 4000, 10000, 20000] },
  // 自动续跑导出存放在 sessionStorage 的 key
  pendingKey: 'wr_export_pending',
  readerPathPrefix: '/web/reader/',
};

export const ENDPOINTS = {
  notebooks: '/api/user/notebook',
  bookmarkList: '/web/book/bookmarklist',
  reviewList: '/api/review/list',
  chapterInfos: '/web/book/chapterInfos',
  readInfo: '/web/book/readinfo',
  bookInfo: '/web/book/info',
  shelfSync: '/web/shelf/sync',
  loginInfo: '/web/login/getinfo',
};
